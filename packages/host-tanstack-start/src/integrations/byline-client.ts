/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * The admin webapp's `BylineClient` singleton.
 *
 * Configured with a `requestContext` factory that resolves the
 * authenticated admin actor per call via `getAdminRequestContext`. Every
 * admin server fn that reads documents goes through this client, so the
 * full read pipeline (`beforeRead` → `findDocuments` → `populate` →
 * `afterRead`) is uniform between admin and any future external
 * client. The collection runtime, db adapter, and storage provider are
 * sourced from the shared `getServerConfig()` so we don't duplicate
 * adapter wiring.
 */

import { createSuperAdminContext } from '@byline/auth'
import { type BylineClient, createBylineClient } from '@byline/client'
import { getServerConfig } from '@byline/core'

import { getAdminRequestContext } from '../auth/auth-context.js'

let cachedClient: BylineClient | undefined

export function getAdminBylineClient(): BylineClient {
  if (cachedClient) return cachedClient
  cachedClient = createBylineClient({
    config: getServerConfig(),
    // Resolved per-call so each server fn picks up the actor from the
    // current request's session cookies. `getAdminRequestContext` runs the
    // refresh dance on its own and throws `ERR_UNAUTHENTICATED` when no
    // session is present — the client surfaces the throw verbatim.
    requestContext: getAdminRequestContext,
  })
  return cachedClient
}

let cachedSystemClient: BylineClient | undefined

/**
 * A `BylineClient` bound to an explicit super-admin context — for
 * **system / background** work that is not scoped to an HTTP request:
 * lifecycle-hook search indexing, maintenance scripts, seeds, migrations.
 *
 * Unlike {@link getAdminBylineClient}, this does **not** read session
 * cookies, so it works outside the TanStack Start server runtime (a bare
 * `tsx` script, a seed, a test). Reaching for the request-scoped client in
 * a lifecycle hook couples that hook to the live server and throws
 * `No StartEvent found in AsyncLocalStorage` from any out-of-band write
 * path. Indexing is maintenance, not a user action — it reads the published
 * view and bypasses `beforeRead` — so the super-admin context is both
 * correct and runtime-agnostic. The context is auditable by its stable id.
 */
export function getSystemBylineClient(): BylineClient {
  if (cachedSystemClient) return cachedSystemClient
  cachedSystemClient = createBylineClient({
    config: getServerConfig(),
    requestContext: createSuperAdminContext({ id: 'byline-system-client' }),
  })
  return cachedSystemClient
}
