/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Shared field-tree walker.
 *
 * `walkFieldTree(fields, data)` traverses a `(FieldSet, data)` pair in
 * lockstep, descending through `group` / `array` / `blocks` structure
 * fields and yielding every value-leaf it finds. Consumers filter by
 * `field.type` and apply their own domain checks (e.g. relation envelope
 * shape, populate-spec match, `_resolved` skip, richText null handling).
 *
 * Both `collectRelationLeaves` (populate.ts) and `collectRichTextLeaves`
 * (richtext-populate.ts) are now thin filters over this primitive — see
 * docs/TODO.md "walkFieldTree" entry for the rationale.
 */

import {
  type Field,
  type FieldSet,
  isArrayField,
  isBlocksField,
  isGroupField,
} from '../@types/field-types.js'

/**
 * One value-leaf yielded by `walkFieldTree`. The walker hands back a
 * reference to the *parent container* (`parent[key]`) so consumers can
 * mutate or replace the value in place — `parent[key] === value` always
 * holds at yield time.
 *
 * `fieldPath` is the dotted path from the root of the walk, with array
 * indices spelled inline (`faq.0.answer`, `content.1.richText`). Suitable
 * for error messages and debug logging.
 */
export interface FieldLeaf {
  field: Field
  value: unknown
  parent: Record<string, any>
  key: string
  fieldPath: string
}

/**
 * Walk a field set and a matching reconstructed data tree in lockstep,
 * yielding every value-leaf the schema declares regardless of nesting
 * depth.
 *
 * **What counts as a leaf:** every non-structure field whose value is
 * non-null. Structure fields (`group` / `array` / `blocks`) are descended
 * into, never yielded themselves. Null / undefined values are skipped
 * silently — the schema is the source of truth for *where* a leaf might
 * be; the data is the source of truth for *whether one is currently set*.
 *
 * Tolerates malformed data gracefully:
 *   - a `group` whose data is missing or non-object yields nothing
 *   - an `array` whose data isn't an array yields nothing
 *   - a `blocks` item with a missing or unknown `_type` is skipped
 *
 * The walker is synchronous and lazy (a generator). Async work — DB
 * fetches, hook fan-out — happens in the consumer after the walk yields.
 */
export function* walkFieldTree(
  fields: FieldSet,
  data: Record<string, any> | null | undefined,
  pathPrefix = ''
): Generator<FieldLeaf, void, void> {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) return
  for (const field of fields) {
    const fieldPath = pathPrefix === '' ? field.name : `${pathPrefix}.${field.name}`
    yield* walkField(field, data, field.name, fieldPath)
  }
}

function* walkField(
  field: Field,
  parent: Record<string, any>,
  key: string,
  fieldPath: string
): Generator<FieldLeaf, void, void> {
  const value = parent[key]
  if (value == null) return

  if (isGroupField(field)) {
    if (typeof value !== 'object' || Array.isArray(value)) return
    yield* walkFieldTree(field.fields, value as Record<string, any>, fieldPath)
    return
  }

  if (isArrayField(field)) {
    if (!Array.isArray(value)) return
    for (let i = 0; i < value.length; i++) {
      const item = value[i]
      if (item == null || typeof item !== 'object' || Array.isArray(item)) continue
      yield* walkFieldTree(field.fields, item as Record<string, any>, `${fieldPath}.${i}`)
    }
    return
  }

  if (isBlocksField(field)) {
    if (!Array.isArray(value)) return
    for (let i = 0; i < value.length; i++) {
      const item = value[i] as Record<string, any> | null | undefined
      if (item == null || typeof item !== 'object' || Array.isArray(item)) continue
      const blockType = item._type
      if (typeof blockType !== 'string') continue
      const block = field.blocks.find((b) => b.blockType === blockType)
      if (!block) continue
      yield* walkFieldTree(block.fields, item, `${fieldPath}.${i}`)
    }
    return
  }

  yield { field, value, parent, key, fieldPath }
}
