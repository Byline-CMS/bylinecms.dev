/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type CollectionDefinition, resolveHooks } from '../../@types/index.js'
import { assertActorCanPerform } from '../../auth/assert-actor-can-perform.js'
import { ERR_NOT_FOUND } from '../../lib/errors.js'
import { withLogContext } from '../../lib/logger.js'
import { type SlugifierFn, slugify } from '../../utils/slugify.js'
import { getDefaultStatus } from '../../workflow/workflow.js'
import { assignCounterValues } from '../assign-counter-values.js'
import {
  applyRichTextEmbed,
  derivePath,
  extractDocumentId,
  extractVersionId,
  invokeHook,
  isPathConflictError,
  maybeAppendOrderKey,
  rethrowPathConflict,
  stripMetaIdsInPlace,
} from './internals.js'
import type { DocumentLifecycleContext } from './context.js'

export interface DuplicateDocumentResult {
  /** The newly-created document's id. */
  documentId: string
  /** The newly-created version id (every duplicate starts at version 1). */
  documentVersionId: string
  /** The id of the document this duplicate was cloned from. */
  sourceDocumentId: string
  /**
   * Final `path` written into `byline_document_paths` for the new document.
   * Surfaced in the result so the UI can include it in success toasts /
   * navigate to it directly.
   */
  newPath: string
  /**
   * `true` when the candidate path collided with an existing row and the
   * lifecycle retried with a short-UUID suffix. UIs can surface a hint that
   * the auto-generated path is uglier than usual so the editor knows to
   * adjust it via the path widget.
   */
  pathRetried: boolean
}

/**
 * Apply the `" (copy)"` suffix to the configured `useAsTitle` field on a
 * duplicate's data tree. Handles both shapes:
 *
 *   - Localized title — `fields[useAsTitle]` is `{ en: '...', fr: '...' }`,
 *     suffix is applied to every locale's value.
 *   - Non-localized title — `fields[useAsTitle]` is a plain string;
 *     suffix appended once.
 *
 * No-op when the collection has no `useAsTitle` or the title is null /
 * undefined; the duplicate proceeds with the source's title verbatim and
 * the editor can rename it. Mutates the tree in place.
 */
function applyDuplicateTitleSuffix(
  definition: CollectionDefinition,
  fields: Record<string, any>,
  suffix: string
): void {
  const titleField = definition.useAsTitle
  if (titleField == null) return
  const value = fields[titleField]
  if (value == null) return
  if (typeof value === 'string') {
    fields[titleField] = value + suffix
    return
  }
  if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
    const localized = value as Record<string, unknown>
    for (const loc of Object.keys(localized)) {
      const v = localized[loc]
      if (typeof v === 'string') {
        localized[loc] = v + suffix
      }
    }
  }
}

/**
 * Compute the candidate path for a duplicate.
 *
 * Reads the default-locale value of `definition.useAsPath` (peeling the
 * localized-shape wrapper if present) and runs it through the existing
 * `derivePath` helper. Falls back to `crypto.randomUUID()` when no source
 * value is available — matches `createDocument`'s behaviour for paths
 * that can't be slugged.
 */
function deriveDuplicateCandidatePath(
  definition: CollectionDefinition,
  fields: Record<string, any>,
  defaultLocale: string,
  slugifier: SlugifierFn
): string {
  const useAsPath = definition.useAsPath
  if (useAsPath == null) {
    return crypto.randomUUID()
  }
  const raw = fields[useAsPath]
  // Peel the localized wrapper to find the default-locale value.
  let sourceValue: any = raw
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw) && !(raw instanceof Date)) {
    sourceValue = (raw as Record<string, unknown>)[defaultLocale]
  }
  return derivePath(definition, { [useAsPath]: sourceValue }, defaultLocale, slugifier)
}

/**
 * Duplicate a document, cloning all of its locales into a brand-new
 * document atomically.
 *
 * Flow:
 *   1. `assertActorCanPerform('create')` — duplicating is a create at the
 *      ability level. The source must be readable (any RBAC scoping the
 *      caller has applies via the storage read).
 *   2. Fetch the source with `locale: 'all'` so a single read carries the
 *      full multi-locale tree forward.
 *   3. Deep-clone the source fields; strip block / array-item `_id` meta
 *      so the new doc gets fresh identities.
 *   4. Append `" (copy)"` to the `useAsTitle` field's value(s).
 *   5. Derive a candidate path from the default-locale suffixed title.
 *   6. `hooks.beforeCreate({ data, collectionPath, duplicate })`.
 *   7. `db.commands.documents.createDocumentVersion(...)` with `locale:
 *      'all'`, `action: 'create'`, no `documentId` → fresh document_id.
 *      On `ERR_PATH_CONFLICT` retry once with the candidate path plus a
 *      4-char UUID suffix; bounded to two attempts, no existence
 *      pre-check, no TOCTOU race.
 *   8. `hooks.afterCreate({ data, collectionPath, documentId,
 *      documentVersionId, duplicate })`.
 *
 * The write is atomic at the storage layer — a partial duplicate is
 * structurally impossible. Editors are expected to rename both the
 * title and the system path after the operation; the UI surfaces a
 * confirmation modal that calls this out.
 */
export async function duplicateDocument(
  ctx: DocumentLifecycleContext,
  params: { sourceDocumentId: string }
): Promise<DuplicateDocumentResult> {
  return withLogContext(
    { domain: 'services', module: 'lifecycle', function: 'duplicateDocument' },
    async () => {
      const { db, definition, collectionId, collectionPath, defaultLocale } = ctx
      assertActorCanPerform(ctx.requestContext, collectionPath, 'create')
      const slugifier = ctx.slugifier ?? slugify
      const hooks = await resolveHooks(definition)

      // 1. Read source with locale='all' — single read, full multi-locale tree.
      const source = await db.queries.documents.getDocumentById({
        collection_id: collectionId,
        document_id: params.sourceDocumentId,
        locale: 'all',
        reconstruct: true,
        lenient: true,
        requestContext: ctx.requestContext,
      })

      if (source == null) {
        throw ERR_NOT_FOUND({
          message: 'source document not found',
          details: { sourceDocumentId: params.sourceDocumentId, collectionPath },
        }).log(ctx.logger)
      }

      const sourceRecord = source as Record<string, any>
      const sourceFields: Record<string, any> = sourceRecord.fields ?? {}

      // 2. Deep clone — we'll mutate (suffix titles, strip meta ids).
      const clonedFields = structuredClone(sourceFields) as Record<string, any>

      // 3. Fresh block / array-item identities for the new doc.
      stripMetaIdsInPlace(clonedFields)

      // 4. Suffix titles per locale (or once if non-localized).
      const titleSuffix = ' (copy)'
      applyDuplicateTitleSuffix(definition, clonedFields, titleSuffix)

      // 5. Derive candidate path from the (now suffixed) default-locale title.
      const candidatePath = deriveDuplicateCandidatePath(
        definition,
        clonedFields,
        defaultLocale,
        slugifier
      )

      // 6. beforeCreate hook with duplicate marker.
      const duplicateMarker = { sourceDocumentId: params.sourceDocumentId }
      await invokeHook(hooks?.beforeCreate, {
        data: clonedFields,
        collectionPath,
        duplicate: duplicateMarker,
      })

      // 6b. Reset counter fields to freshly-allocated values. The clone
      // currently carries the source document's counter values; without
      // this pass, the duplicate would alias the source's facet IDs and
      // break the "one ID per term" contract.
      await assignCounterValues({
        fields: definition.fields,
        data: clonedFields,
        counters: db.commands.counters,
      })

      // 7. Atomic write. Try the candidate path; on ERR_PATH_CONFLICT
      //    retry once with a 4-char UUID suffix.
      const defaultStatus = getDefaultStatus(definition)
      let finalPath = candidatePath
      let pathRetried = false
      let result: { document: any; fieldCount: number }
      // Append-at-end order_key for `orderable: true` collections. Computed
      // before the insert; the source row's order is intentionally not
      // copied — duplicates land at the end of the list.
      const orderKey = await maybeAppendOrderKey(ctx, collectionPath)

      // Embed walker (no-op for multi-locale richtext leaves — see
      // restoreDocumentVersion for the same caveat).
      await applyRichTextEmbed(ctx, clonedFields)
      try {
        result = await db.commands.documents
          .createDocumentVersion({
            collectionId,
            collectionVersion: ctx.collectionVersion,
            collectionConfig: definition,
            action: 'create',
            documentData: clonedFields,
            path: finalPath,
            status: defaultStatus,
            locale: 'all',
            orderKey,
          })
          .catch((err: unknown) => rethrowPathConflict(err, finalPath, defaultLocale))
      } catch (err: unknown) {
        if (!isPathConflictError(err)) {
          throw err
        }
        // Single retry with a short UUID suffix. crypto.randomUUID() is
        // 36 chars; take the first 4 hex digits for a compact disambiguator.
        const shortDisambiguator = crypto.randomUUID().slice(0, 4)
        finalPath = `${candidatePath}-${shortDisambiguator}`
        pathRetried = true
        ctx.logger?.info(
          { candidatePath, retryPath: finalPath, sourceDocumentId: params.sourceDocumentId },
          'duplicateDocument: candidate path collided, retrying with short-UUID suffix'
        )
        result = await db.commands.documents
          .createDocumentVersion({
            collectionId,
            collectionVersion: ctx.collectionVersion,
            collectionConfig: definition,
            action: 'create',
            documentData: clonedFields,
            path: finalPath,
            status: defaultStatus,
            locale: 'all',
            orderKey,
          })
          .catch((retryErr: unknown) => rethrowPathConflict(retryErr, finalPath, defaultLocale))
      }

      const newDocumentId = extractDocumentId(result.document)
      const newDocumentVersionId = extractVersionId(result.document)

      // 8. afterCreate hook with duplicate marker.
      await invokeHook(hooks?.afterCreate, {
        data: clonedFields,
        collectionPath,
        documentId: newDocumentId,
        documentVersionId: newDocumentVersionId,
        path: finalPath,
        duplicate: duplicateMarker,
      })

      return {
        documentId: newDocumentId,
        documentVersionId: newDocumentVersionId,
        sourceDocumentId: params.sourceDocumentId,
        newPath: finalPath,
        pathRetried,
      }
    }
  )
}
