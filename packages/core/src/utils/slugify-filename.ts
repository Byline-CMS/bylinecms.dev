/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Context passed to a `FilenameSlugifierFn`.
 *
 * `collectionPath` - The collection receiving the upload. Lets an
 *                    installation-supplied slugifier branch by collection
 *                    if filename policies differ.
 * `fieldName`      - The upload field's name within the collection.
 * `mimeType`       - The uploaded file's MIME type.
 */
export type FilenameSlugifyContext = {
  collectionPath: string
  fieldName: string
  mimeType: string
}

/**
 * A pure function that converts an uploaded file's **base name** (extension
 * already split off) into a storage-safe slug. The extension is handled by
 * the framework — lowercased and reattached after slugification — so
 * implementations only see and return the base name.
 *
 * Registered installation-wide via `ServerConfig.uploads.filenameSlugifier`;
 * the parallel of `ServerConfig.slugifier` for document paths. Must be
 * synchronous and side-effect free. Return value is sanitised again by the
 * storage provider as a safety net, but implementations should stay within
 * `A–Z a–z 0–9 . _ -` to keep the slug authoritative.
 */
export type FilenameSlugifierFn = (basename: string, ctx: FilenameSlugifyContext) => string

/**
 * Default filename slugifier — lowercases, replaces unsafe characters with
 * hyphens, collapses runs, trims leading/trailing hyphens, and falls back
 * to `'file'` for empty results. Mirrors the storage providers' own
 * sanitisation rules so the default round-trips them unchanged.
 */
export const slugifyFilename: FilenameSlugifierFn = (basename) => {
  const safe = basename
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return safe || 'file'
}

/**
 * Resolve an uploaded file's stored filename: split the extension, apply the
 * installation slugifier (or the default) to the base name, and reattach the
 * lowercased extension. This runs in `uploadField` **before** the
 * `beforeStore` hook chain, so hooks observe (and may override) the
 * already-slugified name — the same ordering the previous fixed sanitiser
 * had.
 */
export function resolveUploadFilename(
  originalFilename: string,
  slugifier: FilenameSlugifierFn | undefined,
  ctx: FilenameSlugifyContext
): string {
  const lastDot = originalFilename.lastIndexOf('.')
  const ext = lastDot > 0 ? originalFilename.slice(lastDot).toLowerCase() : ''
  const base = lastDot > 0 ? originalFilename.slice(0, lastDot) : originalFilename
  const slug = (slugifier ?? slugifyFilename)(base, ctx)
  return `${slug || 'file'}${ext}`
}
