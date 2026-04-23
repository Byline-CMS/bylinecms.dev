/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { v7 as uuidv7 } from 'uuid'

import { type Actor, AdminAuth } from './actor.js'

/**
 * Request-scoped context threaded through every admin server fn,
 * `document-lifecycle` service, `IDocumentQueries` method, `@byline/client`
 * entry point, and collection hook.
 *
 * The auth subsystem populates `actor`; downstream code reads it. Phase 0
 * threading is plumbing only — assertions turn on in Phase 4.
 *
 * `RequestContext` is intentionally independent of the existing
 * `ReadContext` (populate / `afterRead` recursion guard) for now. Merging
 * them is a potential follow-up if it earns its keep; keeping them
 * separate in Phase 0 avoids churning every populate call site.
 *
 * Fields:
 *   - `actor`        — the authenticated identity (or `null` for public
 *                      read paths). Phase 4 enforces that `null` is only
 *                      permitted when `readMode === 'published'`.
 *   - `requestId`    — monotonic-ish UUIDv7 per logical request. Surfaces
 *                      in log lines and error cause chains.
 *   - `locale`       — optional content locale for this request. When
 *                      omitted, callers fall back to the default locale
 *                      from `ServerConfig.i18n.content.defaultLocale`.
 *   - `readMode`     — `'any'` (admin default) or `'published'` (public
 *                      default). Mirrors the existing `ReadMode` on
 *                      `IDocumentQueries` call options; threaded here so
 *                      the auth layer can reason about the public-read
 *                      case uniformly.
 */
export interface RequestContext {
  actor: Actor
  requestId: string
  locale?: string
  readMode?: 'any' | 'published'
}

/** Build a fresh `RequestContext`. All fields optional for ergonomic test/script construction. */
export function createRequestContext(overrides?: Partial<RequestContext>): RequestContext {
  return {
    actor: overrides?.actor ?? null,
    requestId: overrides?.requestId ?? uuidv7(),
    locale: overrides?.locale,
    readMode: overrides?.readMode,
  }
}

/**
 * Construct an explicit super-admin `RequestContext` for scripts, seeds,
 * and tests.
 *
 * The super-admin bypass on `AdminAuth.isSuperAdmin` short-circuits every
 * ability check downstream — which is exactly what migration scripts and
 * seeders need, but it is also why this helper is **explicit**: callers
 * must state "I am acting as super-admin" in code so the fact is
 * auditable. No ambient bypass, no environment-variable escape hatch.
 */
export function createSuperAdminContext(params?: {
  id?: string
  requestId?: string
  locale?: string
}): RequestContext {
  const actor = new AdminAuth({
    id: params?.id ?? 'super-admin',
    abilities: [],
    isSuperAdmin: true,
  })
  return {
    actor,
    requestId: params?.requestId ?? uuidv7(),
    locale: params?.locale,
  }
}
