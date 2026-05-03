/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

'use client'

import type { CSSProperties } from 'react'

import type { StoredFileValue } from '@byline/core'
import cx from 'classnames'

import { getVariant, getWebpVariantSrcSet } from '@/ui/utils/image-sources.ts'

/**
 * Responsive `<picture>` driven by Byline's image-field upload value.
 *
 * Collection-agnostic — the only data dependency is `StoredFileValue`,
 * the per-field upload metadata that any `image` field carries. So a
 * caller hands in `media.image` from a populated relation, an avatar's
 * `image` field, an inline upload — whatever — and gets back a webp
 * srcSet plus a sensible fallback.
 *
 * `size` caps the variants included in the srcSet and provides a
 * default `sizes` hint:
 *
 * - `large`  — every variant; fills the viewport.
 * - `medium` — caps at the `tablet` variant (≤ 1280w).
 * - `small`  — caps at the `mobile` variant (≤ 768w); ideal for list
 *              thumbnails inside a CSS grid.
 */
export interface ResponsiveImageProps {
  /** Upload value — typically `<doc>.image` from a populated relation. */
  image: StoredFileValue | undefined | null
  /** Width cap for variants in the srcSet. */
  size?: 'large' | 'medium' | 'small'
  /**
   * Layout-context hint set by a parent that constrains the image's
   * rendered width on desktop (e.g. a 50%-column block, a floated
   * inline image). Reduces the default `sizes` hint so the browser
   * picks a smaller variant from the srcSet — no visual change, just
   * fewer downloaded bytes.
   *
   * Override entirely by passing `sizes` instead.
   */
  constrainedLayout?: boolean
  /**
   * Explicit CSS `sizes` hint passed to the `<source>`. Overrides the
   * `size` / `constrainedLayout` defaults. Pass this when the rendered
   * width does not match either heuristic.
   */
  sizes?: string
  alt?: string
  /** Applied to the wrapping `<picture>`. */
  className?: string
  /** Applied to the inner `<img>`. */
  imgClassName?: string
  /**
   * Mobile bleed-to-edge — negative gutters on mobile, normal flow on
   * desktop. Useful for hero/photo blocks rendered inside a constrained
   * article layout.
   */
  bleedOnMobile?: boolean
  loading?: 'lazy' | 'eager'
  fetchPriority?: 'high' | 'low' | 'auto'
  /**
   * Variant-name fallback chain for the `<img src>`. The browser may
   * paint this while the responsive srcSet resolves, and uses it as
   * the absolute fallback. Default prefers the smallest variant
   * available.
   */
  fallback?: string[]
  style?: CSSProperties
}

/**
 * Default `sizes` hints by `size` × `constrainedLayout`. The
 * constrained column halves the desktop viewport portion; mobile
 * always assumes the image fills the viewport (most layouts stack on
 * narrow screens). Each cell is a CSS `sizes` string.
 */
const SIZES_TABLE: Record<
  'large' | 'medium' | 'small',
  Record<'default' | 'constrained', string>
> = {
  large: {
    default: '100vw',
    constrained: '(min-width: 768px) 50vw, 100vw',
  },
  medium: {
    default: '(min-width: 768px) 50vw, 100vw',
    constrained: '(min-width: 768px) 25vw, 100vw',
  },
  small: {
    default: '(min-width: 768px) 33vw, 50vw',
    constrained: '(min-width: 768px) 20vw, 50vw',
  },
}

const SRC_SET_CAP: Record<'large' | 'medium' | 'small', 'auto' | 'medium' | 'small'> = {
  large: 'auto',
  medium: 'medium',
  small: 'small',
}

const DEFAULT_FALLBACK_CHAIN = ['thumbnail', 'card', 'mobile']

export function ResponsiveImage({
  image,
  size = 'large',
  constrainedLayout = false,
  sizes,
  alt = '',
  className,
  imgClassName,
  bleedOnMobile = false,
  loading = 'lazy',
  fetchPriority,
  fallback = DEFAULT_FALLBACK_CHAIN,
  style,
}: ResponsiveImageProps): React.JSX.Element | null {
  if (image?.storageUrl == null) return null

  const pictureClasses = cx(
    'flex not-prose overflow-hidden',
    bleedOnMobile
      ? '-ml-[18px] -mr-[18px] max-w-[calc(100%+36px)] sm:mx-0 sm:w-full'
      : 'mx-0 w-full',
    className
  )

  // SVG bypass — variants are not generated for SVG; render the original.
  if (image.mimeType === 'image/svg+xml') {
    return (
      <picture className={pictureClasses}>
        <img
          className={cx('not-prose', imgClassName)}
          style={style}
          src={image.storageUrl}
          alt={alt}
          width={image.imageWidth ?? undefined}
          height={image.imageHeight ?? undefined}
          loading={loading}
          fetchPriority={fetchPriority}
        />
      </picture>
    )
  }

  const webpSrcSet = getWebpVariantSrcSet(image, SRC_SET_CAP[size])
  const fallbackSrc =
    fallback
      .map((name) => getVariant(image, name)?.storageUrl)
      .find((url): url is string => url != null) ?? image.storageUrl
  const resolvedSizes = sizes ?? SIZES_TABLE[size][constrainedLayout ? 'constrained' : 'default']

  return (
    <picture className={pictureClasses}>
      {webpSrcSet.length > 0 && (
        <source srcSet={webpSrcSet.join(', ')} type="image/webp" sizes={resolvedSizes} />
      )}
      <img
        className={cx('not-prose', imgClassName)}
        style={style}
        src={fallbackSrc}
        alt={alt}
        width={image.imageWidth ?? undefined}
        height={image.imageHeight ?? undefined}
        loading={loading}
        fetchPriority={fetchPriority}
      />
    </picture>
  )
}
