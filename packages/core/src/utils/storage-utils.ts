/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  type Field,
  type FileField,
  type ImageField,
  isArrayField,
  isBlocksField,
  isGroupField,
} from '../@types/field-types.js'
import type { CollectionDefinition } from '../@types/collection-types.js'

/**
 * Predicate: does this field carry an `upload` config? True for any
 * `image` / `file` field with an `upload` block declared.
 */
export function isUploadField(field: Field): field is (ImageField | FileField) & {
  upload: NonNullable<(ImageField | FileField)['upload']>
} {
  return (field.type === 'image' || field.type === 'file') && field.upload != null
}

/**
 * Walk the field set and return every upload-capable image/file field
 * on the collection, recursing into `group` / `array` / `blocks`
 * structure fields. Used by the delete path, the upload-route resolver,
 * and any UI that needs to reason about "is this collection
 * upload-capable, and which fields take uploads?"
 *
 * Field names are the upload transport's selector, so a schema should
 * not declare two upload fields with the same name in different nesting
 * scopes — resolvers match by name and take the first hit in
 * declaration order.
 */
export function getUploadFields(
  definition: Pick<CollectionDefinition, 'fields'>
): (ImageField | FileField)[] {
  const found: (ImageField | FileField)[] = []
  collectUploadFields(definition.fields, found)
  return found
}

function collectUploadFields(fields: readonly Field[], found: (ImageField | FileField)[]): void {
  for (const field of fields) {
    if (isUploadField(field)) {
      found.push(field)
    } else if (isGroupField(field) || isArrayField(field)) {
      collectUploadFields(field.fields, found)
    } else if (isBlocksField(field)) {
      for (const block of field.blocks) {
        collectUploadFields(block.fields, found)
      }
    }
  }
}

/**
 * Convenience: does this collection have at least one upload-capable
 * image/file field at any nesting depth? Replaces the old
 * `definition.upload != null` discriminator that "this collection is
 * an upload collection / media library."
 */
export function hasUploadField(definition: Pick<CollectionDefinition, 'fields'>): boolean {
  return getUploadFields(definition).length > 0
}
