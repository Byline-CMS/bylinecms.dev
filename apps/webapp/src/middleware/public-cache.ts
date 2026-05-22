/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Shared server middleware that marks a response as publicly cacheable at
 * the CDN.
 *
 * Used by:
 *   - The public `_frontend` route loader (HTML page render path).
 *   - Public-read server fns (`getPageDetailFn`, `getDocsListFn`,
 *     `getDocDetailFn`) so client-side route transitions don't always
 *     round-trip to origin.
 *
 * Cache-Control directives:
 *   - `public`            — shared caches (Cloudflare) may store this.
 *   - `s-maxage=60`       — CDN treats the response as fresh for 60s.
 *   - `stale-while-revalidate=86400` — for the next 24h after expiry the
 *                                       CDN may serve the stale copy while
 *                                       it refreshes in the background.
 *
 * Preview-mode safety:
 *   - Cloudflare auto-bypasses cache on requests that carry cookies.
 *     Signed-in admins with the `byline_preview` cookie therefore always
 *     reach the origin and see drafts; anonymous visitors with no cookies
 *     are served from the edge cache. We do NOT have to branch in the
 *     middleware itself — the CDN's default cookie-presence bypass does
 *     the right thing.
 *   - DO NOT apply this middleware to any server fn whose result depends
 *     on the caller's identity (e.g. `getCurrentAdminUserSoft`,
 *     `getPreviewStateFn`). Those must always be fresh per-visitor.
 */

import { createMiddleware } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'

export const publicCacheMiddleware = createMiddleware().server(async ({ next }) => {
  setResponseHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=86400')
  return next()
})
