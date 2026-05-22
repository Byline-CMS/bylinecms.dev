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
 *     (`byline_access_token` / `byline_refresh_token`) or the preview-mode
 *     cookie (`byline_preview`), emit `Cache-Control: private, no-store`.
 *     The CDN will neither store the response nor serve any previously
 *     cached entry for that request, so signed-in editors always see live
 *     content and their just-published edits appear immediately.
 *   - Otherwise emit `Cache-Control: public, s-maxage=60,
 *     stale-while-revalidate=86400`. Anonymous traffic is served from the
 *     CDN edge for 60s, with a 24h SWR window for background refresh.
 *
 * Why explicit branching (rather than relying on cookie-presence bypass):
 *   - Cloudflare honours an explicit `s-maxage=N` regardless of cookies
 *     unless a Cache Rule is configured to bypass on cookie match.
 *     Defaulting to public caching and trusting a configured bypass is
 *     fragile — a forgotten rule or zone migration leaks anonymous HTML
 *     to authenticated editors. Branching at origin is the authoritative
 *     fix; a Cloudflare Cache Rule on the same cookies is defence in
 *     depth, not the primary mechanism.
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
import { PREVIEW_COOKIE } from '@byline/host-tanstack-start/auth/preview-cookies'

const CACHE_BYPASS_COOKIES = [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, PREVIEW_COOKIE] as const

function hasCacheBypassCookie(): boolean {
  return CACHE_BYPASS_COOKIES.some((name) => getCookie(name) != null)
}

export const publicCacheMiddleware = createMiddleware().server(async ({ next }) => {
  if (hasCacheBypassCookie()) {
    setResponseHeader('Cache-Control', 'private, no-store')
  } else {
    setResponseHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=86400')
  }
  return next()
})
