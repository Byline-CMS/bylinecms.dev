/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AdminPermissionsRepository } from './modules/admin-permissions/repository.js'
import type { AdminPreferencesRepository } from './modules/admin-preferences/repository.js'
import type { AdminRolesRepository } from './modules/admin-roles/repository.js'
import type {
  AdminUsersRepository,
  AdminUserWithPasswordRow,
} from './modules/admin-users/repository.js'
import type { LoginSessionsRepository } from './modules/auth/login-sessions-repository.js'
import type { RefreshTokensRepository } from './modules/auth/refresh-tokens-repository.js'
import type { SignInRateLimitStore } from './modules/auth/sign-in-rate-limiter.js'

/**
 * The bundle of repositories that `@byline/admin` needs from the DB
 * adapter. A DB adapter package (`@byline/db-postgres`, a future
 * `@byline/db-mysql`) is expected to expose a factory — conventionally
 * `createAdminStore(db)` — that returns an `AdminStore` wired against
 * its concrete schema. The bundle is passed to the built-in
 * `JwtSessionProvider`, to `seedSuperAdmin`, and (later) to admin-user
 * and admin-role commands.
 *
 * Keeping the repositories together as a single argument avoids
 * exploding constructor signatures and makes "needs admin DB access" a
 * single, recognisable type.
 */

export interface AdminStore {
  /**
   * Serialize native issuance/revocation against account mutations. Lock the
   * account row first, then operate on refresh rows through the scoped store.
   * The callback and all its writes commit together or roll back together.
   * Never retain the scoped repositories beyond the callback. No automatic retries.
   */
  withSessionLock<T>(
    adminUserId: string,
    work: (store: AdminStore, user: AdminUserWithPasswordRow | null) => Promise<T>
  ): Promise<T>
  /** Lock distinct account IDs in sorted order in one transaction for account-switch sign-in. */
  withSessionLocks<T>(adminUserIds: string[], work: (store: AdminStore) => Promise<T>): Promise<T>
  loginSessions: LoginSessionsRepository
  signInRateLimits: SignInRateLimitStore
  adminUsers: AdminUsersRepository
  adminRoles: AdminRolesRepository
  adminPermissions: AdminPermissionsRepository
  refreshTokens: RefreshTokensRepository
  adminPreferences: AdminPreferencesRepository
}
