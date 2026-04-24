/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Lazy singleton for the `AdminStore` used by admin-user server fns.
 *
 * `createAdminStore` runs once per process and memoises the four
 * adapter repositories against the Drizzle handle carried on
 * `bylineCore.db`. The session provider gets its own store via
 * `byline.server.config.ts` — this accessor exists so webapp server fns
 * don't need to reach into the adapter themselves or reconstruct the
 * store on every request.
 */

import type { AdminStore } from '@byline/admin'
import type { PgAdapter } from '@byline/db-postgres'
import { createAdminStore } from '@byline/db-postgres/auth'

import { bylineCore } from '../../../../byline.server.config.js'

let cached: AdminStore | null = null

export function getAdminStore(): AdminStore {
  if (cached != null) return cached
  cached = createAdminStore((bylineCore.db as PgAdapter).drizzle)
  return cached
}
