/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { FieldSet } from '../../@types/index.js'

/**
 * Whether positional locale copy-forward would use a different item structure.
 * Compare the already-loaded editable fields, including containers nested in
 * groups, array items and blocks. Values can change without requiring a map read.
 * An omitted item ID retains the existing positional matching contract.
 */
export function hasStructuralChanges(
  fields: FieldSet,
  previous: Record<string, any>,
  incoming: Record<string, any>
): boolean {
  for (const field of fields) {
    const old = previous[field.name]
    const value = incoming[field.name]
    if (field.type === 'group') {
      if (hasStructuralChanges(field.fields, old ?? {}, value ?? {})) return true
    } else if (field.type === 'array' || field.type === 'blocks') {
      const before = Array.isArray(old) ? old : []
      const after = Array.isArray(value) ? value : []
      if (before.length !== after.length) return true
      for (let index = 0; index < after.length; index++) {
        const prior = before[index]
        const item = after[index]
        if (item?._id != null && item._id !== prior?._id) return true
        if (field.type === 'blocks' && item?._type !== prior?._type) return true
        const childFields =
          field.type === 'array'
            ? field.fields
            : field.blocks.find((block) => block.blockType === item?._type)?.fields
        if (childFields && hasStructuralChanges(childFields, prior ?? {}, item ?? {})) return true
      }
    }
  }
  return false
}
