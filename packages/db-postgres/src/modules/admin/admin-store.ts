/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AdminStore } from '@byline/admin'
import { eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { adminUsers } from '../../database/schema/auth.js'
import { createAdminPermissionsRepository } from './admin-permissions-repository.js'
import { createAdminPreferencesRepository } from './admin-preferences-repository.js'
import { createAdminRolesRepository } from './admin-roles-repository.js'
import { createAdminUsersRepository } from './admin-users-repository.js'
import { createLoginSessionsRepository } from './login-sessions-repository.js'
import { createRefreshTokensRepository } from './refresh-tokens-repository.js'
import { createSignInRateLimitStore } from './sign-in-rate-limit-store.js'
import type * as schema from '../../database/schema/index.js'

/**
 * Wire the five admin repositories against a Drizzle handle and return the
 * `AdminStore` bundle expected by `@byline/admin` — specifically by the
 * built-in `JwtSessionProvider`, by `seedSuperAdmin`, and (later) by the
 * admin-user / admin-role commands.
 *
 * Construct once per process, alongside the `pgAdapter` call.
 */
export function createAdminStore(db: NodePgDatabase<typeof schema>): AdminStore {
  return {
    async withSessionLock(adminUserId, work) {
      return db.transaction(async (tx) => {
        await tx
          .select({ id: adminUsers.id })
          .from(adminUsers)
          .where(eq(adminUsers.id, adminUserId))
          .for('update')
        const scoped = createAdminStore(tx)
        const user = await scoped.adminUsers.getByIdForSignIn(adminUserId)
        return work(scoped, user)
      })
    },
    async withSessionLocks(adminUserIds, work) {
      return db.transaction(async (tx) => {
        for (const id of [...new Set(adminUserIds)].sort()) {
          await tx
            .select({ id: adminUsers.id })
            .from(adminUsers)
            .where(eq(adminUsers.id, id))
            .for('update')
        }
        return work(createAdminStore(tx))
      })
    },
    loginSessions: createLoginSessionsRepository(db),
    signInRateLimits: createSignInRateLimitStore(db),
    adminUsers: createAdminUsersRepository(db),
    adminRoles: createAdminRolesRepository(db),
    adminPermissions: createAdminPermissionsRepository(db),
    refreshTokens: createRefreshTokensRepository(db),
    adminPreferences: createAdminPreferencesRepository(db),
  }
}
