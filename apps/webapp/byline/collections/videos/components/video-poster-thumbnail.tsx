/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { FormatterProps, StoredFileValue } from '@byline/core'

import styles from './video-poster-thumbnail.module.css'

/**
 * Preview cell for the Videos list view and relation picker.
 *
 * A video cannot be rendered as a table cell, so the poster stands in for it.
 * Records uploaded before the poster field existed have none, hence the
 * placeholder rather than a broken image.
 */
export function VideoPosterThumbnail({ record }: FormatterProps) {
  const fields = (record as Record<string, any>).fields ?? {}
  const poster = fields.poster as StoredFileValue | null | undefined

  if (!poster?.storageUrl) {
    return <span className={styles.placeholder}>—</span>
  }

  const thumbnail = poster.variants?.find((variant) => variant.name === 'thumbnail')

  return (
    <img
      src={thumbnail?.storageUrl ?? poster.storageUrl}
      alt={typeof fields.alt === 'string' ? fields.alt : 'Video poster'}
      className={styles.thumbnail}
      loading="lazy"
    />
  )
}
