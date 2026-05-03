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

import {
  type Field,
  type FieldSet,
  isArrayField,
  isBlocksField,
  isGroupField,
  type RichTextField,
  type RichTextPopulateFn,
} from '../@types/field-types.js'
import type { CollectionDefinition } from '../@types/collection-types.js'
import type { ReadContext } from '../@types/index.js'

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
 * depth. Recurses through `group` (nested object), `array` (array of
 * sub-objects), and `blocks` (array of `_type`-discriminated sub-objects).
 *
 * Tolerates missing data — a `group` whose data is absent simply yields
 * nothing under that subtree, rather than throwing. The schema is the
 * source of truth for *where* a richText might be; the data is the source
 * of truth for *whether one is currently set*.
 */
export function* collectRichTextLeaves(
  fields: FieldSet,
  data: Record<string, any> | null | undefined,
  pathPrefix = ''
): Generator<RichTextLeaf, void, void> {
  if (data == null) return
  for (const field of fields) {
    const here = pathPrefix === '' ? field.name : `${pathPrefix}.${field.name}`
    yield* walkField(field, data[field.name], here)
  }
}

function* walkField(
  field: Field,
  value: unknown,
  fieldPath: string
): Generator<RichTextLeaf, void, void> {
  if (field.type === 'richText') {
    if (value === undefined || value === null) return
    yield { field, value, fieldPath }
    return
  }

  if (isGroupField(field)) {
    if (value == null || typeof value !== 'object') return
    yield* collectRichTextLeaves(field.fields, value as Record<string, any>, fieldPath)
    return
  }

  if (isArrayField(field)) {
    if (!Array.isArray(value)) return
    for (let i = 0; i < value.length; i++) {
      const item = value[i]
      if (item == null || typeof item !== 'object') continue
      yield* collectRichTextLeaves(field.fields, item as Record<string, any>, `${fieldPath}.${i}`)
    }
    return
  }

  if (isBlocksField(field)) {
    if (!Array.isArray(value)) return
    for (let i = 0; i < value.length; i++) {
      const item = value[i] as Record<string, any> | null | undefined
      if (item == null || typeof item !== 'object') continue
      const blockType = item._type as string | undefined
      if (!blockType) continue
      const block = field.blocks.find((b) => b.blockType === blockType)
      if (!block) continue
      yield* collectRichTextLeaves(block.fields, item, `${fieldPath}.${i}`)
    }
    return
  }

  // Any other field type — value-only leaves with no nested richText.
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
  const { fields, collectionPath, documents, populate, readContext } = options
  for (const doc of documents) {
    const docFields = (doc.fields ?? {}) as Record<string, any>
    for (const leaf of collectRichTextLeaves(fields, docFields)) {
      if (!resolvePopulateOnRead(leaf.field)) continue
      await populate({
        value: leaf.value,
        fieldPath: leaf.fieldPath,
        collectionPath,
        readContext,
      })
    }
  }
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
 * Validate every richText field across every collection. Throws on:
 *   1. `embedRelationsOnSave === false && populateRelationsOnRead === false`
 *      — would be unrenderable.
 *   2. Effective `populateRelationsOnRead === true` and no server-side
 *      `RichTextPopulateFn` registered — populate would be a no-op and
 *      the field would render with stale (or empty) embedded data.
 *
 * Called once at `initBylineCore()` time. Fail-fast at boot is the right
 * posture; the alternative is a silent broken renderer at request time.
 */
export function validateRichTextFieldFlags(
  collections: CollectionDefinition[],
  hasServerAdapter: boolean
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
      if (populate && !hasServerAdapter) {
        errors.push(
          `[${def.path}] richText field '${declaredPath}' requires read-time populate ` +
            `(embedRelationsOnSave=${embed}, populateRelationsOnRead=${populate}) but no ` +
            `richtext server adapter is registered. Wire one via ` +
            `ServerConfig.fields.richText.populate — see ` +
            `\`@byline/richtext-lexical/server\` → \`lexicalEditorServer()\`.`
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
