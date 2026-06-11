/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Meta helper for TanStack Start / Router.
 *
 * Returns the `{ meta, links }` shape expected by a route's `head` option.
 * Child-route entries with the same `name`/`property`/`title` override the
 * defaults set by `__root.tsx`, so most pages only need to pass the fields
 * they want to change.
 *
 * Usage:
 *   export const Route = createFileRoute('/$lng/_frontend/about')({
 *     head: () => getMeta({ title: 'About', path: '/about' }),
 *     component: About,
 *   })
 */

import type { StoredFileValue } from '@byline/core'

import { getPublicConfig } from '@/config'
import { i18nConfig } from '@/i18n/i18n-config'

export interface MetaImage {
  url?: string
  width?: number
  height?: number
  type?: string
  alt?: string
}

export interface MetaOptions {
  /** Page title — rendered as `${siteName} - ${title}`. Omit on the home page. */
  title?: string
  /** Path used to build the canonical / og:url. Defaults to `/`. */
  path?: string
  /** Page description. Falls back to the site description. */
  description?: string
  /** Override the open-graph image. */
  image?: MetaImage
  /** Override the twitter image (defaults to `image` if set). */
  twitterImage?: MetaImage
  /** `og:type` — defaults to `'website'`. Use `'article'` for content pages. */
  ogType?: string
  /**
   * hreflang alternates — one per *advertised* content language. Build via
   * `resolveAlternates` (`@/lib/alternates`) so meta + sitemap stay in sync.
   * When non-empty, an `x-default` alternate is also emitted (see `xDefaultPath`).
   */
  alternates?: Array<{ hreflang: string; path: string }>
  /** Path for the `x-default` hreflang. Emitted only alongside `alternates`. */
  xDefaultPath?: string
  /**
   * Path of the page's markdown representation (canonical + `.md`).
   * Emits `<link rel="alternate" type="text/markdown">` — one of the three
   * advertisement channels for the agent-readable surface, alongside the
   * `.md` URL convention itself and `llms.txt`.
   */
  markdownAlternatePath?: string
}

export interface MetaHead {
  meta: Array<Record<string, string>>
  links: Array<Record<string, string>>
}

export function getMeta(options: MetaOptions = {}): MetaHead {
  const { siteName, siteDescription, serverUrl } = getPublicConfig()
  const title = options.title != null ? `${siteName} - ${options.title}` : siteName
  const description = options.description ?? siteDescription

  // Canonical + og:url are page-specific and should only be emitted when a
  // path is supplied. The root layout calls `getMeta()` with no args to
  // populate site-wide defaults (title, description, og:image, etc.); it
  // intentionally does NOT set a canonical so the leaf route can own it.
  // `links` entries are de-duplicated by deep-equality (not by `rel`), so
  // emitting a default `/` canonical here would produce two `<link
  // rel="canonical">` tags in the final HTML.
  const url = options.path != null ? new URL(options.path, serverUrl).toString() : null

  const defaultOgImage: Required<MetaImage> = {
    url: '/opengraph-image.png',
    width: 1200,
    height: 630,
    type: 'image/png',
    alt: siteDescription,
  }
  const defaultTwitterImage: Required<MetaImage> = {
    url: '/twitter-image.png',
    width: 1200,
    height: 675,
    type: 'image/png',
    alt: siteDescription,
  }

  const og = { ...defaultOgImage, ...options.image }
  const tw = { ...defaultTwitterImage, ...(options.twitterImage ?? options.image) }

  // hreflang cluster — emitted only when the document advertises ≥1 language
  // (a lone x-default is meaningless). Each entry is absolutised against the
  // public server URL; Google prefers absolute hreflang hrefs. The current
  // page's own locale is included when it's flagged, giving the
  // self-referential alternate Google expects.
  const alternates = options.alternates ?? []
  const alternateLinks =
    alternates.length > 0
      ? [
          // React renders these via `<HeadContent />` as `<link>` DOM
          // elements, so the prop must be the camelCase `hrefLang` — the
          // lowercase `hreflang` trips React's "Invalid DOM property" warning
          // and isn't applied as the proper attribute on the client.
          ...alternates.map((a) => ({
            rel: 'alternate',
            hrefLang: a.hreflang,
            href: new URL(a.path, serverUrl).toString(),
          })),
          ...(options.xDefaultPath != null
            ? [
                {
                  rel: 'alternate',
                  hrefLang: 'x-default',
                  href: new URL(options.xDefaultPath, serverUrl).toString(),
                },
              ]
            : []),
        ]
      : []

  return {
    meta: [
      { title },
      { name: 'application-name', content: siteName },
      { name: 'apple-mobile-web-app-title', content: siteName },
      { name: 'description', content: description },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      ...(url != null ? [{ property: 'og:url', content: url }] : []),
      { property: 'og:type', content: options.ogType ?? 'website' },
      { property: 'og:image', content: new URL(og.url, serverUrl).toString() },
      { property: 'og:image:width', content: String(og.width) },
      { property: 'og:image:height', content: String(og.height) },
      { property: 'og:image:alt', content: og.alt },
      { property: 'og:image:type', content: og.type },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: description },
      { name: 'twitter:image', content: new URL(tw.url, serverUrl).toString() },
      { name: 'twitter:image:width', content: String(tw.width) },
      { name: 'twitter:image:height', content: String(tw.height) },
      { name: 'twitter:image:alt', content: tw.alt },
      { name: 'twitter:image:type', content: tw.type },
    ],
    links: [
      ...(url != null ? [{ rel: 'canonical', href: url }] : []),
      ...(options.markdownAlternatePath != null
        ? [
            {
              rel: 'alternate',
              type: 'text/markdown',
              href: new URL(options.markdownAlternatePath, serverUrl).toString(),
            },
          ]
        : []),
      ...alternateLinks,
    ],
  }
}

/**
 * Build a locale-prefixed URL path from one or more segments.
 *
 * Mirrors the convention used elsewhere in the app (`LangLink`,
 * `useLanguageSwitcher`, `byline/collections/pages/admin.tsx`): the default
 * locale renders without a prefix, all others get `/<lng>` prepended.
 *
 * @example
 *   buildLocalizedPath('en', 'about', 'team')   // -> '/about/team'
 *   buildLocalizedPath('es', 'about', 'team')   // -> '/es/about/team'
 *   buildLocalizedPath(undefined, 'contact')    // -> '/contact'
 */
export function buildLocalizedPath(
  lng: string | undefined,
  ...segments: Array<string | null | undefined>
): string {
  const prefix = lng != null && lng !== i18nConfig.defaultLocale ? `/${lng}` : ''
  const path = segments
    .filter((s): s is string => s != null && s.length > 0)
    .map((s) => s.replace(/^\/+|\/+$/g, ''))
    .filter((s) => s.length > 0)
    .join('/')
  // No segments — return `/` (default locale) or `/<lng>` (no trailing
  // slash) so home-page canonicals stay clean.
  if (path.length === 0) return prefix.length > 0 ? prefix : '/'
  return `${prefix}/${path}`
}

/**
 * Convert a Byline `StoredFileValue` (an `image` field's upload envelope)
 * into a `MetaImage` suitable for `getMeta({ image })`.
 *
 * Returns `undefined` when the upload is empty so callers can use the spread
 * pattern (`...(metaImageFromUpload(…) ? { image: … } : {})`) without
 * conditionals.
 *
 * Width/height/type are only included when present on the upload value —
 * leaving them `undefined` would cause `getMeta` to render the string
 * `"undefined"` into the resulting meta tags.
 *
 * The original `storageUrl` is used (not a Sharp variant). Social-media
 * scrapers (Facebook, X, LinkedIn) handle the originally uploaded
 * jpeg/png/webp reliably; AVIF variant support across scrapers is still
 * inconsistent.
 */
export function metaImageFromUpload(
  image: StoredFileValue | null | undefined,
  alt: string
): MetaImage | undefined {
  if (image?.storageUrl == null) return undefined
  const result: MetaImage = { url: image.storageUrl, alt }
  if (image.imageWidth != null) result.width = image.imageWidth
  if (image.imageHeight != null) result.height = image.imageHeight
  if (image.mimeType != null) result.type = image.mimeType
  return result
}

/**
 * Trim a longer string down to a meta-description-friendly length, breaking
 * cleanly on the last whitespace boundary inside the cap and appending an
 * ellipsis when truncation actually occurred.
 *
 * The `pages` collection's `summary` field is sized for ~100–300 chars; the
 * default cap of 200 keeps the rendered tag comfortably under the ~300-char
 * point where Google and most social scrapers begin truncating.
 */
export function truncateForMeta(input: string, max = 200): string {
  const trimmed = input.trim()
  if (trimmed.length <= max) return trimmed
  const slice = trimmed.slice(0, max)
  const lastSpace = slice.lastIndexOf(' ')
  const head = lastSpace > Math.floor(max * 0.6) ? slice.slice(0, lastSpace) : slice
  return `${head.trimEnd()}…`
}
