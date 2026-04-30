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

import { type BylineClient, createBylineClient } from '@byline/client'
import { getServerConfig } from '@byline/core'

import { getAdminRequestContext } from '../auth/auth-context.js'

let cachedClient: BylineClient | undefined

export function getAdminBylineClient(): BylineClient {
  if (cachedClient) return cachedClient
  const config = getServerConfig()
  cachedClient = createBylineClient({
    db: config.db,
    collections: config.collections,
    storage: config.storage,
    defaultLocale: config.i18n?.content?.defaultLocale,
    // Resolved per-call so each server fn picks up the actor from the
    // current request's session cookies. `getAdminRequestContext` runs the
    // refresh dance on its own and throws `ERR_UNAUTHENTICATED` when no
    // session is present — the client surfaces the throw verbatim.
    requestContext: getAdminRequestContext,
  })
  return cachedClient
}
