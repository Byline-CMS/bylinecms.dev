/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Isomorphic locale URL rewrite pair, wired into `createRouter({ rewrite })`
 * (see `src/router.tsx`). Runs on BOTH the server (incoming request parse)
 * and the client (history-driven navigation), so the matcher always sees a
 * locale-prefixed frontend URL while the address bar stays clean for the
 * default locale.
 *
 * Two invariants, encoded here and pinned by `locale-rewrite.test.ts`:
 *
 *   1. `input` prepends the default locale ONLY for genuine localized
 *      frontend paths. The configured admin and sign-in routes,
 *      TanStack server functions (`/_serverFn`), build assets (`/_build`),
 *      uploads, and static files must pass through untouched — they are
 *      locale-less siblings of the `$lng` frontend tree and would 404 if
 *      prefixed.
 *
 *   2. `output` is "de-DEFAULT", never "de-LOCALIZE". It strips only a
 *      leading default-locale segment (clean URLs for `en`). Non-default
 *      interface locales AND content-only locales (`fr`, `zh-CN`, `th-TH`,
 *      …) are PRESERVED — the visible prefix is what drives content
 *      rendering, the hreflang self-reference, and the canonical. Stripping
 *      them would break the content-locale surface.
 *
 * Locale *negotiation* (cookie / Accept-Language → redirect) is deliberately
 * NOT here: rewrites run before route middleware and cannot read cookies on
 * the client. Negotiation + canonicalisation of an externally-typed
 * `/en/...` live in the server entry (`src/server.ts`) where the original,
 * un-rewritten request is visible.
 */

import { resolveRoutes } from '@byline/core'

import { routes } from '~/public'

import { i18nConfig, isRoutableLocale } from '@/i18n/i18n-config'

/**
 * Fixed top-level URL segments that are NOT part of the localized frontend
 * tree and must never receive a locale prefix. Configured admin, API, and
 * sign-in paths are handled separately above this set so nested paths can be
 * matched precisely:
 *   - `_serverFn`         → TanStack Start server functions (default base)
 *   - `_build`            → TanStack Start build assets (default base)
 *   - `uploads`           → local storage provider (served in `server.ts`)
 */
const resolvedRoutes = resolveRoutes(routes)
const NON_LOCALIZED_ROUTE_PATHS = [
  resolvedRoutes.admin,
  resolvedRoutes.api,
  resolvedRoutes.signIn,
] as const

export const NON_LOCALIZED_SEGMENTS: ReadonlySet<string> = new Set([
  '_serverFn',
  '_build',
  'uploads',
])

/**
 * A path whose final segment carries a file extension — a static asset like
 * `/favicon.ico`, `/fonts/Inter/Inter.woff2`, `/site.webmanifest`. Never
 * localised. Checks the last segment only so a content slug containing a dot
 * is not misclassified by an earlier segment.
 */
function looksLikeAsset(pathname: string): boolean {
  const last = pathname.slice(pathname.lastIndexOf('/') + 1)
  return last.includes('.')
}

/**
 * True when this path participates in the localized frontend tree and is
 * therefore subject to locale prefixing. Bare `/` is the localized home.
 */
export function isLocalizablePath(pathname: string): boolean {
  const first = pathname.split('/')[1] ?? ''
  if (first === '') return true // '/' → localized home
  if (
    NON_LOCALIZED_ROUTE_PATHS.some(
      (routePath) => pathname === routePath || pathname.startsWith(`${routePath}/`)
    )
  ) {
    return false
  }
  if (NON_LOCALIZED_SEGMENTS.has(first)) return false
  // `.md` is the one extension that IS content, not an asset: the markdown
  // representation of a document lives at its canonical URL + `.md` and is
  // locale-prefixed exactly like the HTML page (one variant per content
  // locale — see TODO-INTERNAL.md → markdown export). Checked before the asset
  // heuristic so `/news/foo.md` localizes while `/site.webmanifest` doesn't.
  if (pathname.endsWith('.md')) return true
  if (looksLikeAsset(pathname)) return false
  return true
}

/**
 * Inbound rewrite — the matcher must always see a locale segment. Prepend
 * the default locale to a localizable path that lacks a routable locale
 * prefix. Routable prefixes (interface OR content, incl. `zh-CN`) and
 * non-localized / asset paths are returned unchanged.
 */
export function localeInputRewrite(url: URL): URL {
  const first = url.pathname.split('/')[1] ?? ''
  if (isRoutableLocale(first)) return url
  if (!isLocalizablePath(url.pathname)) return url

  url.pathname =
    url.pathname === '/'
      ? `/${i18nConfig.defaultLocale}`
      : `/${i18nConfig.defaultLocale}${url.pathname}`
  return url
}

/**
 * Outbound rewrite — clean URLs for the DEFAULT locale only. Strip a leading
 * default-locale segment so the address bar and generated hrefs are
 * prefix-free for `en`. Every other routable locale is preserved verbatim.
 */
export function localeOutputRewrite(url: URL): URL {
  const first = url.pathname.split('/')[1] ?? ''
  if (first === i18nConfig.defaultLocale) {
    const rest = url.pathname.slice(`/${i18nConfig.defaultLocale}`.length)
    url.pathname = rest === '' ? '/' : rest
  }
  return url
}
