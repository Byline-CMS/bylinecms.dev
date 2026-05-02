import type { PersistedVariant } from '@byline/core'

import type { MediaFields } from '~/collections/media/schema'

/**
 * Maximum variant width (px) included in a srcSet for each `size` cap.
 *
 * - `auto`   — every variant.
 * - `medium` — drops the largest variant (`desktop` ≥ 2100w).
 * - `small`  — keeps only sub-tablet variants (≤ 768w).
 *
 * Tuned for the `Media.image.upload.sizes` declared in the Media
 * collection schema; safe to widen as the variant set grows.
 */
const SIZE_CAPS: Record<'auto' | 'medium' | 'small', number> = {
  auto: Number.POSITIVE_INFINITY,
  medium: 1280,
  small: 768,
}

type ResolvedVariant = PersistedVariant & { storageUrl: string; width: number }

function isResolvedVariant(v: PersistedVariant): v is ResolvedVariant {
  return v.storageUrl != null && v.width != null
}

/**
 * Build a srcSet of webp variants (`<url> <width>w`) for a populated
 * Media document, sorted ascending by width and filtered by an optional
 * size cap. Variants without a `storageUrl` or `width` are skipped.
 */
export function getWebpVariantSrcSet(
  media: MediaFields,
  maxSize: 'auto' | 'medium' | 'small' = 'auto'
): string[] {
  const cap = SIZE_CAPS[maxSize]
  const variants = media.image?.variants ?? []
  return variants
    .filter(isResolvedVariant)
    .filter((v) => v.format === 'webp' && v.width <= cap)
    .sort((a, b) => a.width - b.width)
    .map((v) => `${v.storageUrl} ${v.width}w`)
}

/**
 * Find a named variant (matching `Media.image.upload.sizes[].name`) on a
 * populated Media document. Returns `undefined` if the variant has not
 * been generated yet or has no storage URL.
 */
export function getVariant(media: MediaFields, name: string): ResolvedVariant | undefined {
  const v = media.image?.variants?.find((variant) => variant.name === name)
  return v != null && isResolvedVariant(v) ? v : undefined
}
