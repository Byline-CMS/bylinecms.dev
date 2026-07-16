/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * The server-side `BylineClient` singletons — four request-authority
 * flavours over one shared `getServerConfig()` wiring. All four share the
 * module-scoped singleton pattern so the SDK's per-instance
 * `collectionRecordCache` is amortised across the process lifetime; what
 * differs is only how each resolves its `RequestContext`:
 *
 *   - `getPublicBylineClient()` — anonymous, published-only. Strict
 *     "preview can never apply": use it for RSS/Atom feeds, sitemaps,
 *     JSON endpoints for third parties, and anything an upstream CDN
 *     might serve without keying off the `byline_preview` cookie.
 *   - `getViewerBylineClient()` — the preview-aware sibling. Behaves
 *     identically to the public client until both the `byline_preview`
 *     cookie is set **and** a valid admin session resolves; then the
 *     per-call factory returns the authenticated `AdminAuth` instead of
 *     the anonymous null actor. Use it on user-facing public reads where
 *     an admin's preview-mode session should be honoured.
 *   - `getAdminBylineClient()` — resolves the authenticated admin actor
 *     per request via `getAdminRequestContext` (session cookies, with the
 *     transparent refresh dance). Every admin server fn read goes through
 *     this client, so the full read pipeline (`beforeRead` →
 *     `findDocuments` → `populate` → `afterRead`) is uniform between
 *     admin and any external client.
 *   - `getSystemBylineClient()` — bound to an explicit super-admin
 *     context for **system / background** work that is not scoped to an
 *     HTTP request: lifecycle-hook search indexing, maintenance scripts,
 *     seeds, migrations. Does not read cookies, so it works outside any
 *     host request runtime. The context is auditable by its stable id.
 *
 * Why `assertActorCanPerform` cares (viewer client): the auth layer only
 * permits anonymous reads when `readMode === 'published'`. If a server fn
 * passes `status: 'any'` to surface drafts, an anonymous request trips
 * the gate and throws — but a preview-mode admin sails through. The
 * source-view selection itself remains a per-call decision: the SDK's
 * `resolveReadMode` defaults to `'published'` regardless of context, so
 * every server fn still has to opt in by passing `status: 'any'`.
 *
 * The viewer contract for callers:
 *
 *   1. Use `getViewerBylineClient()` on any user-facing public read
 *      where an admin's preview-mode session should be honoured; use
 *      `getPublicBylineClient()` where preview must never apply.
 *   2. Call `isPreviewActive()` once per server fn to decide whether to
 *      pass `status: 'any'` on the read.
 *
 * Stale preview cookies fail closed: if the preview cookie is present but
 * no valid admin session resolves, the viewer factory returns the same
 * anonymous + `'published'` context the public client would have used, so
 * the worst case is "preview cookie does nothing".
 *
 * In an application whose generated collection types augment `Register`
 * (see `../register.ts`), every getter here returns a fully typed
 * `BylineClient` — `client.collection('news')` autocompletes paths and
 * returns the generated field shapes.
 */

import { createRequestContext, createSuperAdminContext, type RequestContext } from '@byline/auth'
import { getServerConfig } from '@byline/core'

import { type BylineClient, createBylineClient } from '../client.js'
import { getAdminRequestContext } from './admin-context.js'
import { readPreviewCookie } from './preview-cookies.js'
import { oncePerRequest } from './request-scope.js'

let cachedAdminClient: BylineClient | undefined

export function getAdminBylineClient(): BylineClient {
  if (cachedAdminClient) return cachedAdminClient
  cachedAdminClient = createBylineClient({
    config: getServerConfig(),
    // Resolved from the current request's session cookies, memoized per
    // request: every read in one request binds the same context instance
    // (and requestId), which the ReadContext authority check requires.
    // `getAdminRequestContext` runs the refresh dance on its own and throws
    // `ERR_UNAUTHENTICATED` when no session is present — the client
    // surfaces the throw verbatim.
    requestContext: getAdminRequestContext,
  })
  return cachedAdminClient
}

let cachedSystemClient: BylineClient | undefined

export function getSystemBylineClient(): BylineClient {
  if (cachedSystemClient) return cachedSystemClient
  cachedSystemClient = createBylineClient({
    config: getServerConfig(),
    requestContext: createSuperAdminContext({ id: 'byline-system-client' }),
  })
  return cachedSystemClient
}

/**
 * Anonymous, published-only context — memoized per request so the
 * context (and its requestId) is stable across every read in one
 * request: reads sharing a ReadContext must bind a single request
 * authority.
 */
export function resolvePublicRequestContext(): Promise<RequestContext> {
  return oncePerRequest('byline:public-request-context', async () =>
    createRequestContext({ readMode: 'published' })
  )
}

let cachedPublicClient: BylineClient | undefined

export function getPublicBylineClient(): BylineClient {
  if (cachedPublicClient) return cachedPublicClient
  cachedPublicClient = createBylineClient({
    config: getServerConfig(),
    requestContext: resolvePublicRequestContext,
  })
  return cachedPublicClient
}

/**
 * Preview-aware viewer context — memoized per request so every read in
 * one request binds the same context instance (and requestId): reads
 * sharing a ReadContext must resolve a single request authority.
 */
export function resolveViewerRequestContext(): Promise<RequestContext> {
  return oncePerRequest('byline:viewer-request-context', resolveViewerContext)
}

async function resolveViewerContext(): Promise<RequestContext> {
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
    return { ...ctx, readMode: 'any' as const }
  } catch {
    return createRequestContext({ readMode: 'published' })
  }
}

let cachedViewerClient: BylineClient | undefined

export function getViewerBylineClient(): BylineClient {
  if (cachedViewerClient) return cachedViewerClient
  cachedViewerClient = createBylineClient({
    config: getServerConfig(),
    requestContext: resolveViewerRequestContext,
  })
  return cachedViewerClient
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
