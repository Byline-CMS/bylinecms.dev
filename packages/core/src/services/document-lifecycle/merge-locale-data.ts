/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Copy-to-Locale merge walker.
 *
 * Schema-aware, pure tree merge used by `copyToLocale` to decide, leaf by
 * leaf, whether to take the source locale's value or keep the target's.
 */

import {
  type Field,
  type FieldSet,
  isArrayField,
  isBlocksField,
  isGroupField,
} from '../../@types/index.js'

/**
 * Treat null, undefined, and empty string as "no value" for the purpose
 * of the `overwrite: false` merge rule. We intentionally do NOT treat
 * `0`, `false`, or `[]` / `{}` as empty — they are meaningful values an
 * editor may have set deliberately.
 */
function isEmptyLeafValue(value: unknown): boolean {
  return value == null || value === ''
}

/**
 * Result of merging source-locale and target-locale data trees for
 * `copyToLocale`. `data` is the payload to hand to
 * `createDocumentVersion`; `fieldsUpdated` counts every localized leaf
 * the merge rule chose to overwrite (used for UI toasts).
 */
export interface CopyToLocaleMergeResult {
  data: Record<string, any>
  fieldsUpdated: number
}

/**
 * Build the payload `copyToLocale` will write into the target locale.
 *
 * Walks `definition.fields` and the two reconstructed data trees in
 * lockstep, applying the merge rule at every leaf:
 *
 *   - **Localized leaf, `overwrite: true`** — take source's value (even
 *     when source is empty; overwriting means overwriting).
 *   - **Localized leaf, `overwrite: false`** — take source's value only
 *     when target is empty AND source is non-empty. Otherwise keep
 *     target's value. Empties under this rule are treated by
 *     `isEmptyLeafValue` — `null` / `undefined` / `''`.
 *   - **Non-localized leaf** — always keep target's value. Non-localized
 *     fields live on `locale: 'all'` rows in storage and would be wiped
 *     by the upcoming write if we did not pass them through verbatim.
 *
 * Structure (number of array items, blocks, etc.) follows the *target*
 * tree — copy-to-locale never restructures the document; it only fills
 * in localized leaves at positions the target already has.
 *
 * Pure: mutates nothing. The returned `data` is a fresh tree suitable
 * to pass to `createDocumentVersion`.
 */
export function mergeLocaleData(
  fields: FieldSet,
  sourceData: Record<string, any> | null | undefined,
  targetData: Record<string, any> | null | undefined,
  overwrite: boolean
): CopyToLocaleMergeResult {
  const source = (sourceData ?? {}) as Record<string, any>
  const target = (targetData ?? {}) as Record<string, any>
  const out: Record<string, any> = {}
  let fieldsUpdated = 0

  for (const field of fields) {
    const updated = mergeFieldValue(field, source[field.name], target[field.name], overwrite)
    out[field.name] = updated.value
    fieldsUpdated += updated.fieldsUpdated
  }

  return { data: out, fieldsUpdated }
}

interface MergeFieldOutcome {
  value: any
  fieldsUpdated: number
}

function mergeFieldValue(
  field: Field,
  sourceValue: unknown,
  targetValue: unknown,
  overwrite: boolean
): MergeFieldOutcome {
  if (isGroupField(field)) {
    const childSource = isPlainObject(sourceValue) ? sourceValue : {}
    const childTarget = isPlainObject(targetValue) ? targetValue : {}
    const merged = mergeLocaleData(field.fields, childSource, childTarget, overwrite)
    return { value: merged.data, fieldsUpdated: merged.fieldsUpdated }
  }

  if (isArrayField(field)) {
    if (!Array.isArray(targetValue)) {
      // Target has no array here — keep that. Source is not authoritative
      // for structure under copy-to-locale.
      return { value: targetValue, fieldsUpdated: 0 }
    }
    const sourceItems = Array.isArray(sourceValue) ? sourceValue : []
    const mergedItems: any[] = []
    let count = 0
    for (let i = 0; i < targetValue.length; i++) {
      const tItem = targetValue[i]
      const sItem = sourceItems[i]
      if (!isPlainObject(tItem)) {
        mergedItems.push(tItem)
        continue
      }
      const itemMerge = mergeLocaleData(
        field.fields,
        isPlainObject(sItem) ? sItem : {},
        tItem,
        overwrite
      )
      // Preserve `_id` / `_type` meta on the target item — same identity
      // is carried forward across this update.
      const merged = { ...itemMerge.data } as Record<string, any>
      if (tItem._id !== undefined) merged._id = tItem._id
      if (tItem._type !== undefined) merged._type = tItem._type
      mergedItems.push(merged)
      count += itemMerge.fieldsUpdated
    }
    return { value: mergedItems, fieldsUpdated: count }
  }

  if (isBlocksField(field)) {
    if (!Array.isArray(targetValue)) {
      return { value: targetValue, fieldsUpdated: 0 }
    }
    const sourceItems = Array.isArray(sourceValue) ? sourceValue : []
    const mergedItems: any[] = []
    let count = 0
    for (let i = 0; i < targetValue.length; i++) {
      const tItem = targetValue[i] as Record<string, any> | null | undefined
      if (!isPlainObject(tItem)) {
        mergedItems.push(tItem)
        continue
      }
      const blockType = tItem._type
      const block = field.blocks.find((b) => b.blockType === blockType)
      if (block == null) {
        // Unknown block — pass through unchanged.
        mergedItems.push(tItem)
        continue
      }
      const sItem = sourceItems[i]
      const itemMerge = mergeLocaleData(
        block.fields,
        isPlainObject(sItem) && sItem._type === blockType ? sItem : {},
        tItem,
        overwrite
      )
      const merged = { ...itemMerge.data } as Record<string, any>
      if (tItem._id !== undefined) merged._id = tItem._id
      merged._type = blockType
      mergedItems.push(merged)
      count += itemMerge.fieldsUpdated
    }
    return { value: mergedItems, fieldsUpdated: count }
  }

  // Leaf field.
  const localized = (field as { localized?: boolean }).localized === true
  if (!localized) {
    // Non-localized leaves live on locale: 'all' rows. Pass the target's
    // value through verbatim so the write does not wipe them.
    return { value: targetValue, fieldsUpdated: 0 }
  }

  if (overwrite) {
    return {
      value: sourceValue,
      fieldsUpdated: sourceValue === targetValue ? 0 : 1,
    }
  }

  // overwrite: false — fill only when target is empty AND source has content.
  if (isEmptyLeafValue(targetValue) && !isEmptyLeafValue(sourceValue)) {
    return { value: sourceValue, fieldsUpdated: 1 }
  }
  return { value: targetValue, fieldsUpdated: 0 }
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
