/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * The host's *public-read* `BylineClient` singleton — the strict
 * "preview-can-never-apply" sibling of `getViewerBylineClient`.
 *
 * Configured with `actor: null` and `readMode: 'published'`, full stop.
 * The `requestContext` factory does not consult the `byline_preview`
 * cookie or attempt any admin-session resolution, so an admin browsing
 * with preview mode on cannot accidentally elevate a read that flows
 * through this client. `assertActorCanPerform` permits the null actor
 * exactly on `read` with `readMode === 'published'`, which is what the
 * factory always returns.
 *
 * **Use this client for:**
 *   - RSS feeds, Atom feeds, sitemaps
 *   - JSON or other endpoints exposed to third-party consumers
 *   - any response that an upstream CDN / cache might serve to multiple
 *     visitors without keying off the `byline_preview` cookie
 *
 * **Use `getViewerBylineClient` instead for:**
 *   - user-facing public pages where an admin's preview-mode session
 *     should be honoured
 *
 * Both clients share the same module-scoped singleton pattern so the
 * SDK's per-instance `collectionRecordCache` is amortised across the
 * process lifetime.
 *
 * Companion: `getAdminBylineClient` in `./byline-client.ts` for the
 * admin webapp's authenticated reads (resolves a fresh `RequestContext`
 * from session cookies on every call).
 */

import { createRequestContext } from '@byline/auth'
import { type BylineClient, createBylineClient } from '@byline/client'
import { getServerConfig } from '@byline/core'

let cachedClient: BylineClient | undefined

export function getPublicBylineClient(): BylineClient {
  if (cachedClient) return cachedClient
  cachedClient = createBylineClient({
    config: getServerConfig(),
    requestContext: () => createRequestContext({ readMode: 'published' }),
  })
  return cachedClient
}
