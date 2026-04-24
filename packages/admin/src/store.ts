/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AdminPermissionsRepository } from './modules/admin-permissions/repository.js'
import type { AdminRolesRepository } from './modules/admin-roles/repository.js'
import type { AdminUsersRepository } from './modules/admin-users/repository.js'
import type { RefreshTokensRepository } from './modules/auth/refresh-tokens-repository.js'

/**
 * The bundle of repositories that `@byline/admin` needs from the DB
 * adapter. A DB adapter package (`@byline/db-postgres`, a future
 * `@byline/db-mysql`) is expected to expose a factory — conventionally
 * `createAdminStore(db)` — that returns an `AdminStore` wired against
 * its concrete schema. The bundle is passed to the built-in
 * `JwtSessionProvider`, to `seedSuperAdmin`, and (later) to admin-user
 * and admin-role commands.
 *
 * Keeping the four repositories together as a single argument avoids
 * exploding constructor signatures and makes "needs admin DB access" a
 * single, recognisable type.
 */
export interface AdminStore {
  adminUsers: AdminUsersRepository
  adminRoles: AdminRolesRepository
  adminPermissions: AdminPermissionsRepository
  refreshTokens: RefreshTokensRepository
}
