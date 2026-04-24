/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AdminPermissionsRepository } from '@byline/admin/admin-permissions'
import { and, eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { v7 as uuidv7 } from 'uuid'

import { adminPermissions, adminRoleAdminUser } from '../database/schema/auth.js'
import type * as schema from '../database/schema/index.js'

/**
 * Postgres implementation of `AdminPermissionsRepository` — per-role
 * ability grants and the distinct-abilities-for-user join that drives
 * `resolveActor()`.
 */
export function createAdminPermissionsRepository(
  db: NodePgDatabase<typeof schema>
): AdminPermissionsRepository {
  return {
    async grantAbility(roleId, ability) {
      await db
        .insert(adminPermissions)
        .values({ id: uuidv7(), admin_role_id: roleId, ability })
        .onConflictDoNothing({
          target: [adminPermissions.admin_role_id, adminPermissions.ability],
        })
    },

    async revokeAbility(roleId, ability) {
      await db
        .delete(adminPermissions)
        .where(
          and(eq(adminPermissions.admin_role_id, roleId), eq(adminPermissions.ability, ability))
        )
    },

    async listAbilities(roleId) {
      const rows = await db
        .select({ ability: adminPermissions.ability })
        .from(adminPermissions)
        .where(eq(adminPermissions.admin_role_id, roleId))
      return rows.map((r) => r.ability)
    },

    async setAbilities(roleId, abilities) {
      await db.transaction(async (tx) => {
        await tx.delete(adminPermissions).where(eq(adminPermissions.admin_role_id, roleId))
        if (abilities.length === 0) return
        const rows = abilities.map((ability) => ({
          id: uuidv7(),
          admin_role_id: roleId,
          ability,
        }))
        await tx.insert(adminPermissions).values(rows)
      })
    },

    async listAbilitiesForUser(userId) {
      const rows = await db
        .selectDistinct({ ability: adminPermissions.ability })
        .from(adminPermissions)
        .innerJoin(
          adminRoleAdminUser,
          eq(adminRoleAdminUser.admin_role_id, adminPermissions.admin_role_id)
        )
        .where(eq(adminRoleAdminUser.admin_user_id, userId))
      return rows.map((r) => r.ability)
    },
  }
}
