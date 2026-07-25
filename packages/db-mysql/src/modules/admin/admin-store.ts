/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AdminStore } from '@byline/admin'
import type { MySql2Database } from 'drizzle-orm/mysql2'

import { createAdminPermissionsRepository } from './admin-permissions-repository.js'
import { createAdminPreferencesRepository } from './admin-preferences-repository.js'
import { createAdminRolesRepository } from './admin-roles-repository.js'
import { createAdminUsersRepository } from './admin-users-repository.js'
import { createRefreshTokensRepository } from './refresh-tokens-repository.js'
import type * as schema from '../../database/schema/index.js'

/**
 * Wire the five admin repositories against a Drizzle handle and return the
 * `AdminStore` bundle expected by `@byline/admin` — specifically by the
 * built-in `JwtSessionProvider`, by `seedSuperAdmin`, and by the admin-user /
 * admin-role commands. Mirrors
 * `packages/db-postgres/src/modules/admin/admin-store.ts`.
 *
 * Construct once per process, alongside the `mysqlAdapter` call.
 */
export function createAdminStore(db: MySql2Database<typeof schema>): AdminStore {
  return {
    adminUsers: createAdminUsersRepository(db),
    adminRoles: createAdminRolesRepository(db),
    adminPermissions: createAdminPermissionsRepository(db),
    refreshTokens: createRefreshTokensRepository(db),
    adminPreferences: createAdminPreferencesRepository(db),
  }
}
