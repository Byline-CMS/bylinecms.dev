/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { FormatterProps, StoredFileValue } from '@byline/core'

/**
 * Derive the thumbnail URL from the original storage_url.
 *
 * Sharp writes variants as siblings of the original file using the naming
 * convention `<basename>-<variantName>.<outputExt>`:
 *   `/uploads/media/2026/02/abc-photo.jpg`
 *   → `/uploads/media/2026/02/abc-photo-thumbnail.webp`
 */
function deriveThumbnailUrl(storageUrl: string): string {
  return storageUrl.replace(/\.[^.]+$/, '-thumbnail.webp')
}

/**
 * FormatBadge renders a muted pill showing the image format (e.g. JPEG, PNG, SVG).
 * Intended for use alongside the status badge in list-view card meta.
 */
export function FormatBadge({ format }: { format: string }) {
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset bg-gray-500/10 text-gray-400 ring-gray-500/20">
      {format.toUpperCase()}
    </span>
  )
}

/**
 * MediaThumbnailCell renders a small preview image in the Media list view.
 * When the `thumbnail` variant has been generated, the smaller webp is used;
 * otherwise the original storage URL is shown.
 */
export function MediaThumbnail({ record }: FormatterProps) {
  const doc = record as Record<string, any>
  const img = doc.image as StoredFileValue | null | undefined

  if (!img?.storage_url) {
    return (
      <span className="inline-flex items-center justify-center w-10 h-10 bg-gray-800 rounded text-gray-600 text-[0.6rem]">
        —
      </span>
    )
  }

  const thumbUrl = img.thumbnail_generated ? deriveThumbnailUrl(img.storage_url) : img.storage_url

  return (
    <img
      src={thumbUrl}
      alt={img.original_filename ?? img.filename}
      className="w-10 h-10 object-cover rounded border border-gray-700"
      loading="lazy"
    />
  )
}
