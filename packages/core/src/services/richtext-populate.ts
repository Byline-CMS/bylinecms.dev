/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Richtext populate service — walks a reconstructed document, finds every
 * rich-text leaf (including those nested inside `group` / `array` /
 * `blocks` structures), gates each leaf by its `populateRelationsOnRead`
 * flag, and dispatches to the registered richtext populate adapter.
 *
 * Slots into the read pipeline alongside `populateDocuments`:
 *
 *   findDocuments → reconstruct → populateDocuments → populateRichTextFields → afterRead
 *
 * The same `ReadContext` flows through both populate phases, so dedup /
 * cycle protection / read-budget enforcement covers rich-text fan-out
 * automatically and any nested reads the adapter performs.
 *
 * The adapter is invoked once per leaf rather than once per document so
 * each call has a precise `fieldPath` for error messages and so future
 * adapters can implement per-leaf caching if needed.
 */

import type { RequestContext } from '@byline/auth'

import {
  type Field,
  type FieldSet,
  isArrayField,
  isBlocksField,
  isGroupField,
  type RichTextField,
  type RichTextPopulateFn,
  type RichTextReadDocumentsFn,
} from '../@types/field-types.js'
import { bindReadContextAuthority, compileBeforeReadFilters } from '../auth/apply-before-read.js'
import { assertActorCanPerform } from '../auth/assert-actor-can-perform.js'
import { ERR_READ_BUDGET_EXCEEDED, ERR_VALIDATION } from '../lib/errors.js'
import { applyAfterRead } from './document-read.js'
import { walkFieldTree } from './walk-field-tree.js'
import type { CollectionDefinition } from '../@types/collection-types.js'
import type { DocumentFilter, IDbAdapter, ReadContext, ReadMode } from '../@types/index.js'

/**
 * One rich-text leaf yielded by `collectRichTextLeaves`. The walker hands
 * back a reference to the *parent container* (`parent[key]`) rather than
 * the value alone so adapters that want to *replace* the value (rather
 * than mutate it in place) have a clean way to do so.
 */
export interface RichTextLeaf {
  field: RichTextField
  value: unknown
  fieldPath: string
}

/**
 * Walk a field set and a matching reconstructed data tree in lockstep,
 * yielding every rich-text leaf the schema declares regardless of nesting
 * depth.
 *
 * Tree traversal is delegated to the shared `walkFieldTree` walker; this
 * function is the rich-text-specific filter — it surfaces only leaves
 * whose declared `type === 'richText'` and re-shapes the leaf as a
 * `RichTextLeaf` for downstream callers.
 *
 * Tolerates missing data — a `group` whose data is absent simply yields
 * nothing under that subtree. The schema is the source of truth for
 * *where* a richText might be; the data is the source of truth for
 * *whether one is currently set*.
 */
export function* collectRichTextLeaves(
  fields: FieldSet,
  data: Record<string, any> | null | undefined,
  pathPrefix = ''
): Generator<RichTextLeaf, void, void> {
  for (const leaf of walkFieldTree(fields, data, pathPrefix)) {
    if (leaf.field.type !== 'richText') continue
    yield { field: leaf.field, value: leaf.value, fieldPath: leaf.fieldPath }
  }
}

// ---------------------------------------------------------------------------
// populateRichTextFields — read-pipeline entry point
// ---------------------------------------------------------------------------

export interface PopulateRichTextFieldsOptions {
  /** Source collection's schema fields (used to drive the leaf walk). */
  fields: FieldSet
  collectionPath: string
  documents: Array<Record<string, any>>
  /** Registered server-side populate function from `ServerConfig`. */
  populate: RichTextPopulateFn
  readContext: ReadContext
  requestContext: RequestContext
  readMode: ReadMode
  readDocuments: RichTextReadDocumentsFn
}

/**
 * Resolve the effective `populateRelationsOnRead` for a richText field.
 *   - explicit `true` / `false` wins
 *   - otherwise default-derived as `!embedRelationsOnSave`
 *   - `embedRelationsOnSave` itself defaults to `true`, so the overall
 *     default for `populateRelationsOnRead` is `false` (snapshot mode).
 */
export function resolvePopulateOnRead(field: RichTextField): boolean {
  if (field.populateRelationsOnRead !== undefined) return field.populateRelationsOnRead
  const embed = field.embedRelationsOnSave ?? true
  return !embed
}

/**
 * For every document, walk its rich-text leaves and call the registered
 * populate function for each leaf whose effective `populateRelationsOnRead`
 * is `true`. Mutates document `fields` in place.
 */
export async function populateRichTextFields(
  options: PopulateRichTextFieldsOptions
): Promise<void> {
  const {
    fields,
    collectionPath,
    documents,
    populate,
    readContext,
    requestContext,
    readMode,
    readDocuments,
  } = options
  for (const doc of documents) {
    const docFields = (doc.fields ?? {}) as Record<string, any>
    for (const leaf of collectRichTextLeaves(fields, docFields)) {
      if (!resolvePopulateOnRead(leaf.field)) continue
      await populate({
        value: leaf.value,
        fieldPath: leaf.fieldPath,
        collectionPath,
        readContext,
        requestContext,
        readMode,
        readDocuments,
      })
    }
  }
}

/** Build the secure batch reader exposed to editor-agnostic adapters. */
export function createRichTextDocumentReader(options: {
  db: IDbAdapter
  collections: readonly CollectionDefinition[]
  requestContext: RequestContext
  readContext: ReadContext
  readMode: ReadMode
  locale?: string
  bypassBeforeRead?: true
  /** Private cache domain shared with the originating client read. */
  securityDomain?: object
  /** Adapter reused recursively for rich-text fields on target documents. */
  richTextPopulate?: RichTextPopulateFn
}): RichTextReadDocumentsFn {
  const {
    db,
    collections,
    requestContext,
    readContext,
    readMode,
    locale,
    bypassBeforeRead,
    richTextPopulate,
  } = options
  const securityDomain = options.securityDomain ?? db
  const state = getRichTextReaderState(readContext)

  const read: RichTextReadDocumentsFn = async ({ collectionPath, documentIds, fields }) => {
    bindReadContextAuthority(readContext, requestContext)
    if (documentIds.length === 0) return []
    const definition = collections.find((candidate) => candidate.path === collectionPath)
    if (definition == null) {
      throw ERR_VALIDATION({
        message: `richtext target collection '${collectionPath}' is not registered`,
        details: { collectionPath },
      })
    }

    assertActorCanPerform(requestContext, collectionPath, 'read')

    let filters: DocumentFilter[] | undefined
    if (!bypassBeforeRead) {
      filters = await compileBeforeReadFilters({
        definition,
        requestContext,
        readContext,
        securityDomain,
        parseContext: {
          collections,
          resolveCollectionId: async (path) => {
            const row = await db.queries.collections.getCollectionByPath(path)
            return row?.id ?? ''
          },
        },
      })
    }

    const collection = await db.queries.collections.getCollectionByPath(collectionPath)
    if (collection?.id == null) {
      throw ERR_VALIDATION({
        message: `richtext target collection '${collectionPath}' is not available`,
        details: { collectionPath },
      })
    }

    const collectionId = collection.id as string
    const projection = fields == null ? '*' : [...fields].sort().join(',')
    const resultById = new Map<string, Record<string, any>>()
    const idsToFetch: string[] = []

    for (const documentId of new Set(documentIds)) {
      const key = richTextMaterializationKey(
        collectionId,
        documentId,
        requestContext.requestId,
        locale,
        readMode,
        projection
      )
      if (state.cache.has(key)) {
        const cached = state.cache.get(key)
        if (cached != null) resultById.set(documentId, cached)
      } else if (!state.active.has(`${collectionId}:${documentId}`)) {
        idsToFetch.push(documentId)
      }
    }

    if (idsToFetch.length > 0) {
      const fetched = (await db.queries.documents.getDocumentsByDocumentIds({
        collection_id: collectionId,
        document_ids: idsToFetch,
        fields,
        readMode,
        locale,
        filters: filters && filters.length > 0 ? filters : undefined,
      })) as Array<Record<string, any>>
      const fetchedById = new Map(
        fetched
          .filter((doc) => typeof doc.document_id === 'string')
          .map((doc) => [doc.document_id as string, doc] as const)
      )

      for (const documentId of idsToFetch) {
        const materializationKey = richTextMaterializationKey(
          collectionId,
          documentId,
          requestContext.requestId,
          locale,
          readMode,
          projection
        )
        // Earlier items in this batch may recursively populate a later target.
        // Honour that completed/active state rather than reprocessing the stale
        // raw row captured by the outer batch and overwriting its redacted cache.
        if (state.cache.has(materializationKey)) {
          const cached = state.cache.get(materializationKey)
          if (cached != null) resultById.set(documentId, cached)
          continue
        }
        const documentKey = `${collectionId}:${documentId}`
        if (state.active.has(documentKey)) continue

        const doc = fetchedById.get(documentId)
        if (doc == null) {
          state.cache.set(materializationKey, null)
          continue
        }

        state.active.add(documentKey)
        readContext.visited.add(documentKey)
        try {
          readContext.readCount += 1
          if (readContext.readCount > readContext.maxReads) {
            throw ERR_READ_BUDGET_EXCEEDED({
              message: `richtext populate exceeded read budget (maxReads=${readContext.maxReads})`,
              details: {
                readCount: readContext.readCount,
                maxReads: readContext.maxReads,
                targetCollectionId: collectionId,
                targetDocumentId: documentId,
              },
            })
          }

          if (richTextPopulate) {
            await populateRichTextFields({
              fields: definition.fields,
              collectionPath,
              documents: [doc],
              populate: richTextPopulate,
              readContext,
              requestContext,
              readMode,
              readDocuments: read,
            })
          }
          await applyAfterRead({
            doc,
            definition,
            readContext,
            requestContext,
            locale,
            readMode,
            projection: fields,
            materialization: 'richtext-target',
          })
          state.cache.set(materializationKey, doc)
          resultById.set(documentId, doc)
        } finally {
          state.active.delete(documentKey)
        }
      }
    }

    return documentIds.flatMap((documentId) => {
      const doc = resultById.get(documentId)
      return doc == null ? [] : [doc]
    })
  }

  return read
}

interface RichTextReaderState {
  active: Set<string>
  cache: Map<string, Record<string, any> | null>
}

const richTextReaderStates = new WeakMap<ReadContext, RichTextReaderState>()

function getRichTextReaderState(readContext: ReadContext): RichTextReaderState {
  const existing = richTextReaderStates.get(readContext)
  if (existing) return existing
  const state: RichTextReaderState = { active: new Set(), cache: new Map() }
  richTextReaderStates.set(readContext, state)
  return state
}

function richTextMaterializationKey(
  collectionId: string,
  documentId: string,
  requestId: string,
  locale: string | undefined,
  readMode: ReadMode,
  projection: string
): string {
  return `${collectionId}:${documentId}:${requestId}:${locale ?? 'all'}:${readMode}:${projection}`
}

// ---------------------------------------------------------------------------
// Boot-time validation
// ---------------------------------------------------------------------------

/**
 * Walk the schema (without data) yielding every richText field declared
 * across the schema tree, with a stable dotted path to use in error
 * messages. Distinct from `collectRichTextLeaves`, which walks data.
 */
function* iterRichTextFieldDeclarations(
  fields: FieldSet,
  pathPrefix = ''
): Generator<{ field: RichTextField; declaredPath: string }, void, void> {
  for (const field of fields) {
    const here = pathPrefix === '' ? field.name : `${pathPrefix}.${field.name}`
    yield* walkDeclaration(field, here)
  }
}

function* walkDeclaration(
  field: Field,
  declaredPath: string
): Generator<{ field: RichTextField; declaredPath: string }, void, void> {
  if (field.type === 'richText') {
    yield { field, declaredPath }
    return
  }
  if (isGroupField(field) || isArrayField(field)) {
    yield* iterRichTextFieldDeclarations(field.fields, declaredPath)
    return
  }
  if (isBlocksField(field)) {
    for (const block of field.blocks) {
      yield* iterRichTextFieldDeclarations(block.fields, `${declaredPath}.<${block.blockType}>`)
    }
    return
  }
}

/**
 * Which richtext server adapters the host has registered. Pass both
 * flags so the validator can fail-fast on each missing-adapter case
 * with a specific message.
 */
export interface RichTextAdapterPresence {
  /** `ServerConfig.fields.richText.populate != null` */
  populate: boolean
  /** `ServerConfig.fields.richText.embed != null` */
  embed: boolean
}

/**
 * Validate every richText field across every collection. Throws on:
 *   1. `embedRelationsOnSave === false && populateRelationsOnRead === false`
 *      — would be unrenderable.
 *   2. Effective `populateRelationsOnRead === true` and no server-side
 *      `RichTextPopulateFn` registered — populate would be a no-op and
 *      the field would render with stale (or empty) embedded data.
 *   3. Effective `embedRelationsOnSave === true` and no server-side
 *      `RichTextEmbedFn` registered — saves would silently skip the
 *      walker so internal-link `document.path` envelopes would never
 *      be canonicalised, breaking the renderer's fallback chain.
 *
 * Called once at `initBylineCore()` time. Fail-fast at boot is the right
 * posture; the alternative is a silent broken renderer at request time.
 */
export function validateRichTextFieldFlags(
  collections: readonly CollectionDefinition[],
  adapters: RichTextAdapterPresence
): void {
  const errors: string[] = []
  for (const def of collections) {
    for (const { field, declaredPath } of iterRichTextFieldDeclarations(def.fields)) {
      const embed = field.embedRelationsOnSave ?? true
      const populate = field.populateRelationsOnRead ?? !embed
      if (!embed && !populate) {
        errors.push(
          `[${def.path}] richText field '${declaredPath}' has both ` +
            `embedRelationsOnSave and populateRelationsOnRead set to false. ` +
            `Set at least one to true — otherwise nothing renders.`
        )
        continue
      }
      if (populate && !adapters.populate) {
        errors.push(
          `[${def.path}] richText field '${declaredPath}' requires read-time populate ` +
            `(embedRelationsOnSave=${embed}, populateRelationsOnRead=${populate}) but no ` +
            `richtext populate adapter is registered. Wire one via ` +
            `ServerConfig.fields.richText.populate — see ` +
            `\`@byline/richtext-lexical/server\` → \`lexicalEditorPopulateServer()\`.`
        )
      }
      if (embed && !adapters.embed) {
        errors.push(
          `[${def.path}] richText field '${declaredPath}' requires write-time embed ` +
            `(embedRelationsOnSave=${embed}) but no richtext embed adapter is registered. ` +
            `Wire one via ServerConfig.fields.richText.embed — see ` +
            `\`@byline/richtext-lexical/server\` → \`lexicalEditorEmbedServer()\`.`
        )
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `initBylineCore: richText field configuration errors:\n  - ${errors.join('\n  - ')}`
    )
  }
}
