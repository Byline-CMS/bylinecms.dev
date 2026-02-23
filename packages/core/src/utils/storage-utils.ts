/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { ImageSize } from '../@types/collection-types.js'

/**
 * Derive the storage paths of Sharp-generated image variants from the
 * original file's storage path and the collection's size definitions.
 *
 * This mirrors the naming convention used by `generateImageVariants()` in
 * `@byline/storage-local`:
 *
 *   `<path-without-extension>-<variantName>.<format>`
 *
 * @example
 * ```ts
 * deriveVariantStoragePaths('media/abc123-photo.jpg', [
 *   { name: 'thumbnail', format: 'webp' },
 *   { name: 'desktop',   format: 'webp' },
 * ])
 * // → ['media/abc123-photo-thumbnail.webp', 'media/abc123-photo-desktop.webp']
 * ```
 *
 * Used at document-delete time to identify variant files for cleanup without
 * requiring them to be stored separately in the database.
 */
export function deriveVariantStoragePaths(storagePath: string, sizes: ImageSize[]): string[] {
  if (!sizes || sizes.length === 0) return []
  const lastDot = storagePath.lastIndexOf('.')
  const base = lastDot !== -1 ? storagePath.slice(0, lastDot) : storagePath
  return sizes.map((size) => {
    const format = size.format ?? 'webp'
    return `${base}-${size.name}.${format}`
  })
}
