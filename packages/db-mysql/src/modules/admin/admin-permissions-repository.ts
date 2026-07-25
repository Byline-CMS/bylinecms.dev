/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AdminPermissionsRepository } from '@byline/admin/admin-permissions'
import { DbErrorCodes } from '@byline/core'
import { and, eq } from 'drizzle-orm'
import type { MySql2Database } from 'drizzle-orm/mysql2'
import { v7 as uuidv7 } from 'uuid'

import { adminPermissions, adminRoleAdminUser } from '../../database/schema/auth.js'
import { classifyError } from '../storage/classify-error.js'
import type * as schema from '../../database/schema/index.js'

/**
 * MySQL implementation of `AdminPermissionsRepository` — per-role ability
 * grants and the distinct-abilities-for-user join that drives
 * `resolveActor()`. Ported from
 * `packages/db-postgres/src/modules/admin/admin-permissions-repository.ts`.
 *
 * `grantAbility` — pg's `onConflictDoNothing({ target: [admin_role_id,
 * ability] })` targets the named `uq_byline_admin_permissions_role_ability`
 * constraint specifically. `byline_admin_permissions` carries **two** unique
 * keys — the `id` primary key and that named constraint — so, per the
 * per-table rule this port follows throughout (see
 * `admin-roles-repository.ts`'s `assignToUser` for the one-unique-key
 * counter-case), a plain `.onDuplicateKeyUpdate()` is not safe here: MySQL
 * has no per-constraint targeting, so it would fire — and silently rewrite
 * an existing row — on *either* unique key, when only a collision on the
 * role+ability pair should be swallowed. This uses the insert-then-catch
 * pattern instead (mirrors `writeDocumentPath` in
 * `storage-commands.ts`): try the insert; if it fails with `ER_DUP_ENTRY`
 * on `uq_byline_admin_permissions_role_ability` specifically (detected via
 * the shared `classifyError`), treat it as the idempotent no-op pg's
 * `onConflictDoNothing` gives; any other error (in particular a duplicate
 * on `id`, which — being a fresh UUIDv7 — should never happen in practice,
 * but is structurally a different unique key) rethrows unchanged.
 */
export function createAdminPermissionsRepository(
  db: MySql2Database<typeof schema>
): AdminPermissionsRepository {
  return {
    async grantAbility(roleId, ability) {
      try {
        await db.insert(adminPermissions).values({ id: uuidv7(), admin_role_id: roleId, ability })
      } catch (err) {
        const classification = classifyError(err)
        const isRoleAbilityConflict =
          classification.code === DbErrorCodes.UNIQUE_VIOLATION &&
          classification.constraint === 'uq_byline_admin_permissions_role_ability'
        if (!isRoleAbilityConflict) throw err
        // Already granted — idempotent no-op, matching pg's onConflictDoNothing.
      }
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

    async listRolesForAbility(ability) {
      const rows = await db
        .select({ admin_role_id: adminPermissions.admin_role_id })
        .from(adminPermissions)
        .where(eq(adminPermissions.ability, ability))
      return rows.map((r) => r.admin_role_id)
    },

    async listUsersForAbility(ability) {
      const rows = await db
        .selectDistinct({ admin_user_id: adminRoleAdminUser.admin_user_id })
        .from(adminRoleAdminUser)
        .innerJoin(
          adminPermissions,
          eq(adminPermissions.admin_role_id, adminRoleAdminUser.admin_role_id)
        )
        .where(eq(adminPermissions.ability, ability))
      return rows.map((r) => r.admin_user_id)
    },
  }
}
