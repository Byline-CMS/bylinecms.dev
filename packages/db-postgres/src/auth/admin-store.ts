/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AdminStore } from '@byline/admin'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { createAdminPermissionsRepository } from './admin-permissions-repository.js'
import { createAdminRolesRepository } from './admin-roles-repository.js'
import { createAdminUsersRepository } from './admin-users-repository.js'
import { createRefreshTokensRepository } from './refresh-tokens-repository.js'
import type * as schema from '../database/schema/index.js'

/**
 * Wire the four admin repositories against a Drizzle handle and return the
 * `AdminStore` bundle expected by `@byline/admin` — specifically by the
 * built-in `JwtSessionProvider`, by `seedSuperAdmin`, and (later) by the
 * admin-user / admin-role commands.
 *
 * Construct once per process, alongside the `pgAdapter` call.
 */
export function createAdminStore(db: NodePgDatabase<typeof schema>): AdminStore {
  return {
    adminUsers: createAdminUsersRepository(db),
    adminRoles: createAdminRolesRepository(db),
    adminPermissions: createAdminPermissionsRepository(db),
    refreshTokens: createRefreshTokensRepository(db),
  }
}
