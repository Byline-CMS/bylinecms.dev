/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Shared server middleware that marks a response as publicly cacheable at
 * the CDN — but only for anonymous visitors.
 *
 * Used by:
 *   - The public `_frontend` route loader (HTML page render path).
 *   - Public-read server fns (`getPageDetailFn`, `getDocsListFn`,
 *     `getDocDetailFn`) so client-side route transitions don't always
 *     round-trip to origin.
 *
 * Behaviour:
 *   - If the request carries a Byline admin session cookie
 *     (`byline_access_token` / `byline_refresh_token`), emit
 *     `Cache-Control: private, no-store`. The CDN will neither store the
 *     response nor serve any previously cached entry for that request, so
 *     signed-in editors always see live content and their just-published
 *     edits appear immediately.
 *   - Otherwise emit `Cache-Control: public, max-age=0, s-maxage=60,
 *     stale-while-revalidate=86400`. Anonymous traffic is served from the
 *     CDN edge for 60s, with a 24h SWR window for background refresh.
 *     `max-age=0` keeps the *browser* from storing (or heuristically
 *     caching) the HTML/server-fn response — only the shared CDN cache
 *     holds it (`s-maxage`), so a visitor always revalidates against the
 *     edge rather than serving stale content from their own browser cache.
 *
 * Why the preview cookie is NOT in the bypass set:
 *   - `byline_preview` only takes effect when paired with a valid admin
 *     session. `isPreviewActive()` checks the cookie *and*
 *     `getAdminRequestContext()`; without a session it returns false and
 *     the server returns published content via `status: 'published'`.
 *   - A real preview session always carries the session cookies too, so
 *     bypass is already triggered by those — the preview cookie is
 *     redundant when it matters.
 *   - An anonymous browser carrying a stale `byline_preview` cookie (left
 *     over from a previous sign-in) receives the same published response
 *     any other anonymous browser would, and that response is safe to
 *     cache and to serve from cache. Treating the preview cookie as a
 *     bypass signal would penalise that browser with `no-store` for up to
 *     a day after sign-out for no benefit.
 *
 * Why explicit branching (rather than relying on cookie-presence bypass):
 *   - Cloudflare honours an explicit `s-maxage=N` regardless of cookies
 *     unless a Cache Rule is configured to bypass on cookie match.
 *     Defaulting to public caching and trusting a configured bypass is
 *     fragile — a forgotten rule or zone migration leaks anonymous HTML
 *     to authenticated editors. Branching at origin is the authoritative
 *     fix; a Cloudflare Cache Rule on the same session cookies is defence
 *     in depth, not the primary mechanism.
 *
 * Do NOT apply this middleware to any server fn whose result depends on
 * the caller's identity (e.g. `getCurrentAdminUserSoft`,
 * `getPreviewStateFn`). Those must always be fresh per-visitor and
 * should set their own cache headers (typically `private, no-store`).
 */

import { createMiddleware } from '@tanstack/react-start'
import { getCookie, setResponseHeader } from '@tanstack/react-start/server'

import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from '@byline/host-tanstack-start/auth/auth-cookies'

const CACHE_BYPASS_COOKIES = [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE] as const

function hasCacheBypassCookie(): boolean {
  return CACHE_BYPASS_COOKIES.some((name) => getCookie(name) != null)
}

export const publicCacheMiddleware = createMiddleware().server(async ({ next }) => {
  if (hasCacheBypassCookie()) {
    setResponseHeader('Cache-Control', 'private, no-store')
  } else {
    setResponseHeader(
      'Cache-Control',
      'public, max-age=0, s-maxage=60, stale-while-revalidate=86400'
    )
  }
  return next()
})
