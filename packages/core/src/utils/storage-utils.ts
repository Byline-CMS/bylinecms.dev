/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition } from '../@types/collection-types.js'
import type { Field, FileField, ImageField } from '../@types/field-types.js'

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
 * Walk the top-level field set and return every upload-capable
 * image/file field on the collection. Used by the delete path,
 * the upload-route resolver, and any UI that needs to reason about
 * "is this collection upload-capable, and which fields take uploads?"
 *
 * Does not recurse into `group` / `array` / `blocks` — the supported
 * transport surface is top-level upload fields. Nested upload fields
 * are reachable through the core upload service via `findUploadField`,
 * but require a richer transport selector.
 */
export function getUploadFields(
  definition: Pick<CollectionDefinition, 'fields'>
): (ImageField | FileField)[] {
  return definition.fields.filter(isUploadField)
}

/**
 * Convenience: does this collection have at least one upload-capable
 * image/file field at the top level? Replaces the old
 * `definition.upload != null` discriminator that "this collection is
 * an upload collection / media library."
 */
export function hasUploadField(definition: Pick<CollectionDefinition, 'fields'>): boolean {
  return definition.fields.some(isUploadField)
}
