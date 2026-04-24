/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { Field, FieldSet, GroupField } from '@byline/core'
import { ERR_DATABASE, getLogger } from '@byline/core'

import { fieldTypeToStoreType, type StoreType } from './storage-store-manifest.js'

// ------------------------------------------------------------------------------
// Field name → store type resolution
// ------------------------------------------------------------------------------

/**
 * Given a CollectionDefinition and a list of field names, determine which
 * StoreTypes are needed to satisfy the query. This enables selective field
 * loading — instead of a 7-table UNION ALL, we query only the relevant stores.
 *
 * Field names that don't match a collection field (e.g. 'status', 'updated_at')
 * are silently ignored — they come from the document version row, not EAV stores.
 *
 * Structure fields (array, blocks) recursively include all their children's
 * store types plus 'meta' for _id/_type tracking.
 */
export function resolveStoreTypes(fields: FieldSet, fieldNames: string[]): Set<StoreType> {
  const stores = new Set<StoreType>()

  for (const name of fieldNames) {
    const field = fields.find((f) => f.name === name)
    if (!field) continue
    collectStoreTypes(field, stores)
  }

  return stores
}

function collectStoreTypes(field: Field, stores: Set<StoreType>): void {
  const mapped = fieldTypeToStoreType[field.type]

  if (mapped === 'meta') {
    // Structure field — recurse into children and include meta for _id/_type
    if (field.type === 'array') {
      for (const child of field.fields) {
        collectStoreTypes(child, stores)
      }
    } else if (field.type === 'blocks') {
      for (const block of field.blocks) {
        for (const child of block.fields) {
          collectStoreTypes(child, stores)
        }
      }
    }
    // Meta rows are fetched separately (not via UNION ALL), so no store type to add
  } else if (mapped) {
    stores.add(mapped)
  }
  // undefined (group) or unrecognized — recurse if group
  if (field.type === 'group') {
    for (const child of (field as GroupField).fields) {
      collectStoreTypes(child, stores)
    }
  }
}

// ------------------------------------------------------------------------------
// Misc
// ------------------------------------------------------------------------------

export const getFirstOrThrow =
  <T>(message: string) =>
  (values: T[]): T => {
    const value = values[0]
    if (value == null) {
      throw ERR_DATABASE({ message }).log(getLogger())
    }
    return value
  }
