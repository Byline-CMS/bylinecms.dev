/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * The host's *viewer* `BylineClient` singleton — the preview-aware
 * sibling of `getPublicBylineClient` (`./byline-public-client.ts`).
 * Behaves identically to the public client until both the
 * `byline_preview` cookie is set **and** a valid admin session resolves;
 * at that point the per-call `requestContext` factory returns the
 * authenticated `AdminAuth` instead of the anonymous null actor.
 *
 * Why this matters: `assertActorCanPerform` (packages/core/src/auth) only
 * permits anonymous reads when `readMode === 'published'`. So if a server
 * fn passes `status: 'any'` to surface drafts, an anonymous request
 * trips the gate and throws — but a preview-mode admin sails through. The
 * source-view selection itself remains a per-call decision: the SDK's
 * `resolveReadMode` defaults to `'published'` regardless of context, so
 * every server fn still has to opt in by passing `status: 'any'`.
 *
 * The contract for callers:
 *
 *   1. Use `getViewerBylineClient()` on any user-facing public read
 *      where an admin's preview-mode session should be honoured. Use
 *      `getPublicBylineClient()` instead for endpoints where preview
 *      should never apply (RSS feeds, sitemaps, third-party endpoints,
 *      anything an upstream cache might serve without keying off the
 *      preview cookie).
 *   2. Call `isPreviewActive()` once per server fn to decide whether to
 *      pass `status: 'any'` on the read.
 *
 * Stale cookies fail closed: if the preview cookie is present but no
 * valid admin session resolves, the factory returns the same anonymous
 * + `'published'` context the public client would have used, so the
 * worst case is "preview cookie does nothing".
 *
 * The collection-record cache is per-instance, so a singleton here keeps
 * the same amortisation benefit `getPublicBylineClient` has — the two
 * helpers are parallel singletons (one cached `BylineClient` each).
 */

import { createRequestContext } from '@byline/auth'
import { type BylineClient, createBylineClient } from '@byline/client'
import { getServerConfig } from '@byline/core'

import { getAdminRequestContext } from '../auth/auth-context.js'
import { readPreviewCookie } from '../auth/preview-cookies.js'

let cachedClient: BylineClient | undefined

export function getViewerBylineClient(): BylineClient {
  if (cachedClient) return cachedClient
  cachedClient = createBylineClient({
    config: getServerConfig(),
    requestContext: async () => {
      // No preview cookie → behave exactly like the public client.
      // Cheap path; no JWT verification, no DB lookup.
      if (!readPreviewCookie()) {
        return createRequestContext({ readMode: 'published' })
      }

      // Preview cookie present → try the admin context. A failure means
      // the cookie is stale (admin signed out, session expired, refresh
      // rejected). We swallow the error and fall back to the public
      // context so the page renders instead of erroring.
      try {
        const ctx = await getAdminRequestContext()
        return { ...ctx, readMode: 'any' }
      } catch {
        return createRequestContext({ readMode: 'published' })
      }
    },
  })
  return cachedClient
}

/**
 * Resolve whether the current request should surface non-published
 * versions. True iff the preview cookie is set **and** a valid admin
 * session resolves. Server fns call this once and pass the result to
 * `status: preview ? 'any' : 'published'` on the SDK read.
 *
 * Defensive by design: the cookie alone is not enough. A signed-out
 * browser carrying an old preview cookie still gets `false` here, which
 * keeps stray query strings or shared links from leaking drafts.
 */
export async function isPreviewActive(): Promise<boolean> {
  if (!readPreviewCookie()) return false
  try {
    await getAdminRequestContext()
    return true
  } catch {
    return false
  }
}
