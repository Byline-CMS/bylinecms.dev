/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { ERR_VALIDATION, parseInstancePath } from '@byline/core'

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0
const index = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0
const path = (value: unknown) => text(value) && parseInstancePath(value).ok

function patches(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((patch) => {
      if (!object(patch) || !path(patch.path)) return false
      if (patch.opId !== undefined && !text(patch.opId)) return false
      if (patch.timestamp !== undefined && !text(patch.timestamp)) return false
      switch (patch.kind) {
        case 'field.set':
          return 'value' in patch
        case 'field.clear':
          return true
        case 'array.insert':
          return 'item' in patch && (patch.index === undefined || index(patch.index))
        case 'array.move':
          return text(patch.itemId) && index(patch.toIndex)
        case 'array.remove':
          return text(patch.itemId)
        case 'array.updateItem':
          return text(patch.itemId) && patches(patch.patches)
        case 'block.add':
          return text(patch.blockType) && (patch.index === undefined || index(patch.index))
        case 'block.move':
          return text(patch.blockId) && index(patch.toIndex)
        case 'block.remove':
          return text(patch.blockId)
        case 'block.updateField':
          return text(patch.blockId) && path(patch.fieldPath) && 'value' in patch
        default:
          return false
      }
    })
  )
}

/** Shape checks complement lifecycle authorization, revision and field validation. */
export function validateDocumentWriteInput<T>(input: T, mode: 'create' | 'patch' | 'metadata'): T {
  const valid =
    object(input) &&
    text(input.collection) &&
    (mode === 'create' ? object(input.data) : text(input.id)) &&
    (input.locale === undefined || text(input.locale)) &&
    (input.path == null || typeof input.path === 'string') &&
    (input.availableLocales === undefined ||
      (Array.isArray(input.availableLocales) && input.availableLocales.every(text))) &&
    (mode !== 'patch' || patches(input.patches))
  // Revision errors keep their existing, specialized lifecycle decoder.
  if (!valid) throw ERR_VALIDATION({ message: 'Invalid document write request.' })
  return input
}
