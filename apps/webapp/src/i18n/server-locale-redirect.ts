/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-entry locale negotiation + canonicalisation. Invoked from
 * `src/server.ts` on the ORIGINAL, un-rewritten request — before
 * `handler.fetch` and therefore before the router's `rewrite.input`
 * (which would otherwise prepend the default locale and hide whether the
 * URL arrived bare).
 *
 * This is a REDIRECT concern, deliberately separate from the structural
 * `rewrite` (`src/i18n/locale-rewrite.ts`):
 *
 *   - Canonicalisation: an externally-typed `/en/…` (default locale) 301s to
 *     the clean prefix-free form. Generated links are already clean via
 *     `rewrite.output`, so this only catches hand-typed / external links.
 *   - Negotiation: a bare frontend path with a cookie / Accept-Language
 *     preference for a NON-default interface locale 302s to `/<lng>/…`, so
 *     the choice becomes visible and sticky. A default-locale preference
 *     stays on the clean URL (the router prefixes `en` internally).
 *
 * Only interface locales are negotiated — content-only locales are never
 * auto-applied (they are per-page, non-sticky; see `detectLocale`).
 */

import { detectLocale } from '@/i18n/detect-locale'
import { i18nConfig, isRoutableLocale } from '@/i18n/i18n-config'
import { isLocalizablePath } from '@/i18n/locale-rewrite'

/** Read a single cookie value out of a raw `Cookie` request header. */
function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim())
    }
  }
  return undefined
}

/**
 * Returns a redirect `Response` when the request should be canonicalised or
 * negotiated, or `null` to let it fall through to the router unchanged.
 */
export function negotiateLocaleRedirect(request: Request): Response | null {
  // Only document navigations participate. Server functions (POST), uploads,
  // admin, and static assets pass straight through.
  if (request.method !== 'GET') return null

  const url = new URL(request.url)
  const { pathname } = url
  const firstSegment = pathname.split('/')[1] ?? ''

  if (isRoutableLocale(firstSegment)) {
    // Canonicalise an externally-typed default-locale URL to the clean form.
    if (firstSegment === i18nConfig.defaultLocale) {
      const rest = pathname.slice(`/${firstSegment}`.length) || '/'
      return Response.redirect(new URL(`${rest}${url.search}`, url), 301)
    }
    // A non-default routable prefix (interface or content) is already canonical.
    return null
  }

  // Bare path — negotiate only for localizable frontend paths.
  if (!isLocalizablePath(pathname)) return null

  const detected = detectLocale({
    cookie: readCookie(request.headers.get('cookie'), i18nConfig.cookieName),
    acceptLanguage: request.headers.get('accept-language'),
  })

  // A default-locale preference stays on the clean URL (the router prefixes
  // `en` internally via `rewrite.input`). Only a non-default detection
  // redirects, so the prefix becomes visible and sticky.
  if (detected !== i18nConfig.defaultLocale) {
    return Response.redirect(new URL(`/${detected}${pathname}${url.search}`, url), 302)
  }

  return null
}
