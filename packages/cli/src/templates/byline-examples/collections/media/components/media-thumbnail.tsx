/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { FormatterProps, StoredFileValue } from '@byline/core'

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
 * When a `thumbnail` variant has been generated its `storageUrl` is used;
 * otherwise the original storage URL is shown.
 */
export function MediaThumbnail({ record }: FormatterProps) {
  const doc = record as Record<string, any>
  const fields = doc.fields ?? {}
  const img = fields.image as StoredFileValue | null | undefined

  if (!img?.storageUrl) {
    return (
      <span className="inline-flex items-center justify-center w-18 h-18 bg-gray-800 rounded text-gray-600 text-[0.6rem]">
        —
      </span>
    )
  }

  const thumbVariant = img.variants?.find((v) => v.name === 'thumbnail')
  const thumbUrl = thumbVariant?.storageUrl ?? img.storageUrl

  return (
    <img
      src={thumbUrl}
      alt={img.originalFilename ?? img.filename}
      className="w-18 h-18 object-cover rounded border border-gray-700"
      loading="lazy"
    />
  )
}
