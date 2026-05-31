/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server middleware that handles initial locale negotiation for routes
 * under `{-$lng}` (every public + admin route in this webapp).
 *
 * Attached via `server.middleware` on the `{-$lng}` layout route, so it
 * is path-scoped (descendants of `{-$lng}` only) and server-only — the
 * middleware code is never bundled into the client graph, and it never
 * runs on client-side navigations.
 *
 * Behaviour:
 *   - If the URL already carries a valid locale segment (`/es/...`,
 *     `/fr/...`), pass through — the route's `beforeLoad` will read it
 *     out of `params.lng` and seed the context.
 *   - Otherwise read the locale cookie + Accept-Language header, run
 *     standards-compliant negotiation, and 302-redirect to the
 *     locale-prefixed URL if the detected locale is not the default.
 */

import { redirect } from '@tanstack/react-router'
import { createMiddleware } from '@tanstack/react-start'
import { getCookie, getRequestHeader, getRequestUrl } from '@tanstack/react-start/server'

import { detectLocale } from '@/i18n/detect-locale'
import { i18nConfig, isRoutableLocale } from '@/i18n/i18n-config'

export const localeRedirectMiddleware = createMiddleware().server(async ({ next }) => {
  const url = getRequestUrl()
  const pathname = url.pathname

  // If the URL already carries a routable locale segment, either
  // canonicalise (strip the default-locale prefix for a clean URL) or pass
  // through. A content-only locale segment (e.g. `/fr`) passes through here
  // *without* interface negotiation — the matcher resolves it and the page
  // renders content in that locale with fallback chrome.
  const firstSegment = pathname.split('/')[1]
  if (isRoutableLocale(firstSegment)) {
    if (firstSegment === i18nConfig.defaultLocale) {
      const rest = pathname.slice(`/${firstSegment}`.length) || '/'
      throw redirect({
        href: `${rest}${url.search}`,
        replace: true,
        statusCode: 301, // permanent canonicalisation, safe to cache
      })
    }
    return next()
  }

  const detected = detectLocale({
    cookie: getCookie(i18nConfig.cookieName),
    acceptLanguage: getRequestHeader('accept-language'),
  })

  if (detected !== i18nConfig.defaultLocale) {
    throw redirect({
      href: `/${detected}${pathname}${url.search}`,
      replace: true,
      statusCode: 302,
    })
  }

  return next()
})
