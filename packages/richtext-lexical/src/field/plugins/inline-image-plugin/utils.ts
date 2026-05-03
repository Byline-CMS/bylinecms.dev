/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { StoredFileValue } from '@byline/core'

import type { Position } from '../../nodes/inline-image-node/types'

/**
 * Maps an editor `position` choice to a media-collection variant name.
 * Floated images (`left`/`right`) sit in narrow columns alongside text, so
 * they get the smaller `card` variant. `full` images use the main column,
 * `wide` ones bleed beyond it. Sizes refer to the variants declared on the
 * `media` collection in `apps/webapp/byline/collections/media/schema.ts`.
 */
function variantFor(position: Position): string {
  switch (position) {
    case 'left':
    case 'right':
      return 'card'
    case 'wide':
      return 'desktop'
    default:
      // 'full' | 'default' | undefined
      return 'tablet'
  }
}

export interface PreferredSize {
  url: string
  width?: number
  height?: number
}

/**
 * Choose a sensible image URL + dimensions for the editor preview given the
 * picked media's `image` field and the user's chosen position. Reads
 * directly from `image.variants` (persisted on the file value at upload
 * time). SVGs return the original `storageUrl`; missing/empty variants
 * fall back to the original.
 */
export function getPreferredSize(
  position: Position,
  image: StoredFileValue | null | undefined
): PreferredSize | null {
  if (image?.storageUrl == null) return null

  if (image.mimeType === 'image/svg+xml') {
    return {
      url: image.storageUrl,
      width: image.imageWidth,
      height: image.imageHeight,
    }
  }

  const wanted = variantFor(position)
  const match = image.variants?.find((v) => v.name === wanted)
  if (match?.storageUrl) {
    return {
      url: match.storageUrl,
      width: match.width ?? image.imageWidth,
      height: match.height ?? image.imageHeight,
    }
  }

  return {
    url: image.storageUrl,
    width: image.imageWidth,
    height: image.imageHeight,
  }
}

/**
 * One denormalised image variant — the renderer-facing shape used by the
 * inline-image node and richtext after-read hook. Mirrors the persisted
 * `PersistedVariant` with `storageUrl` renamed to `url` for renderer
 * ergonomics.
 */
export interface DerivedImageSize {
  name: string
  url: string
  width?: number
  height?: number
  format: string
}

/**
 * Map a `StoredFileValue.variants` array into the renderer shape. SVGs and
 * variant-less images return `[]` so renderers fall back to
 * `image.storageUrl`.
 */
export function deriveImageSizes(image: StoredFileValue | null | undefined): DerivedImageSize[] {
  if (!image?.storageUrl) return []
  if (image.mimeType === 'image/svg+xml') return []
  if (!image.variants || image.variants.length === 0) return []

  const out: DerivedImageSize[] = []
  for (const variant of image.variants) {
    if (!variant.storageUrl) continue
    out.push({
      name: variant.name,
      url: variant.storageUrl,
      width: variant.width,
      height: variant.height,
      format: variant.format ?? 'avif',
    })
  }
  return out
}
