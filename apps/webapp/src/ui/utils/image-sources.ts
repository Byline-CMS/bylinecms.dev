import type { PersistedVariant, StoredFileValue } from '@byline/core'

/**
 * Maximum variant width (px) included in a srcSet for each `size` cap.
 *
 * - `auto`   — every variant.
 * - `medium` — drops the largest variant (`desktop` ≥ 2100w).
 * - `small`  — keeps only sub-tablet variants (≤ 768w).
 *
 * Tuned for the variant set declared in the reference Media collection
 * (`Media.image.upload.sizes`); safe to widen as the variant set grows.
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
 * Build a srcSet of webp variants (`<url> <width>w`) for an upload
 * value, sorted ascending by width and filtered by an optional size
 * cap. Variants without a `storageUrl` or `width` are skipped.
 */
export function getWebpVariantSrcSet(
  image: StoredFileValue | undefined | null,
  maxSize: 'auto' | 'medium' | 'small' = 'auto'
): string[] {
  if (image == null) return []
  const cap = SIZE_CAPS[maxSize]
  return (image.variants ?? [])
    .filter(isResolvedVariant)
    .filter((v) => v.format === 'webp' && v.width <= cap)
    .sort((a, b) => a.width - b.width)
    .map((v) => `${v.storageUrl} ${v.width}w`)
}

/**
 * Find a named variant (matching `image.upload.sizes[].name`) on an
 * upload value. Returns `undefined` if the variant has not been
 * generated yet or has no storage URL.
 */
export function getVariant(
  image: StoredFileValue | undefined | null,
  name: string
): ResolvedVariant | undefined {
  const v = image?.variants?.find((variant) => variant.name === name)
  return v != null && isResolvedVariant(v) ? v : undefined
}

/**
 * Resolve a single URL from an upload value, walking a preference list
 * of variant names and finally falling back to the original
 * `storageUrl`. Useful for non-responsive contexts that need a single
 * `<img src>` (avatars, list thumbnails before they were swapped to
 * `<picture>`, social-share preview URLs, etc.).
 */
export function pickVariantUrl(
  image: StoredFileValue | undefined | null,
  ...preferred: string[]
): string | undefined {
  if (image == null) return undefined
  const variants = image.variants ?? []
  for (const name of preferred) {
    const hit = variants.find((v) => v.name === name)
    if (hit?.storageUrl != null) return hit.storageUrl
  }
  return image.storageUrl
}
