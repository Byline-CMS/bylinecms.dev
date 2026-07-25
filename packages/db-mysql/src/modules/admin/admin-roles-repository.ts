/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  type AdminRoleRow,
  type AdminRolesRepository,
  ERR_ADMIN_ROLE_VERSION_CONFLICT,
} from '@byline/admin/admin-roles'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { MySql2Database } from 'drizzle-orm/mysql2'
import { v7 as uuidv7 } from 'uuid'

import { adminRoleAdminUser, adminRoles } from '../../database/schema/auth.js'
import { affectedRowCount } from '../storage/storage-utils.js'
import type * as schema from '../../database/schema/index.js'

/**
 * MySQL implementation of `AdminRolesRepository` — role CRUD, reorder, and
 * role ↔ user assignments. Ability grants live on `AdminPermissionsRepository`
 * (see `admin-permissions-repository.ts`). Ported from
 * `packages/db-postgres/src/modules/admin/admin-roles-repository.ts`.
 *
 * `create`/`update` follow the same `.returning()` → construct-in-JS
 * approach as `admin-users-repository.ts` (see that file's docblock for the
 * full rationale): `create`'s `created_at`/`updated_at` are captured once as
 * `now` and used for both the `INSERT` and the returned row; `update` reads
 * the current row first (values the patch didn't touch aren't otherwise
 * knowable) and merges the patch onto it in JS, with the vid-guarded
 * `UPDATE`'s affected-row count as the sole accept/reject authority.
 *
 * Unlike `admin-users-repository.ts`'s `update`/`setPasswordHash` (which
 * re-`SELECT` post-`UPDATE` — see that file's docblock for why), `update`
 * here safely returns the pre-read-merged row: every mutator of
 * `byline_admin_roles` — `update` itself and `reorder` — bumps `vid`, so
 * there is no vid-less mutator on this table analogous to admin-users'
 * `recordLoginSuccess`/`recordLoginFailure` that could leave a pre-read
 * snapshot stale while the guarded `UPDATE` still succeeds. If a future
 * change adds a vid-less mutator to this table, revisit this.
 *
 * `assignToUser`'s upsert uses a plain `.onDuplicateKeyUpdate()` no-op
 * idiom (`admin_role_id = admin_role_id`) rather than the insert-then-catch
 * pattern `admin-permissions-repository.ts` needs: `byline_admin_role_
 * admin_user` carries exactly one unique key — the composite primary key
 * `(admin_role_id, admin_user_id)` targeted here — so a duplicate-key
 * collision on this table can only be that one key, and MySQL's lack of
 * per-constraint targeting is a non-issue.
 */

const PUBLIC_ROLE_COLUMNS = {
  id: adminRoles.id,
  vid: adminRoles.vid,
  name: adminRoles.name,
  machine_name: adminRoles.machine_name,
  description: adminRoles.description,
  order: adminRoles.order,
  created_at: adminRoles.created_at,
  updated_at: adminRoles.updated_at,
} as const

export function createAdminRolesRepository(
  db: MySql2Database<typeof schema>
): AdminRolesRepository {
  return {
    // -----------------------------------------------------------------
    // Role CRUD
    // -----------------------------------------------------------------

    async create(input): Promise<AdminRoleRow> {
      const id = uuidv7()
      const now = new Date()
      const row: AdminRoleRow = {
        id,
        vid: 1,
        name: input.name,
        machine_name: input.machine_name,
        description: input.description ?? null,
        order: input.order ?? 0,
        created_at: now,
        updated_at: now,
      }
      await db.insert(adminRoles).values({
        id: row.id,
        name: row.name,
        machine_name: row.machine_name,
        description: row.description,
        order: row.order,
        created_at: now,
        updated_at: now,
      })
      return row
    },

    async getById(id) {
      const [row] = await db
        .select(PUBLIC_ROLE_COLUMNS)
        .from(adminRoles)
        .where(eq(adminRoles.id, id))
      return row ?? null
    },

    async getByMachineName(machineName) {
      const [row] = await db
        .select(PUBLIC_ROLE_COLUMNS)
        .from(adminRoles)
        .where(eq(adminRoles.machine_name, machineName))
      return row ?? null
    },

    async list() {
      return db
        .select(PUBLIC_ROLE_COLUMNS)
        .from(adminRoles)
        .orderBy(asc(adminRoles.order), asc(adminRoles.created_at))
    },

    async update(id, expectedVid, patch): Promise<AdminRoleRow> {
      const [current] = await db
        .select(PUBLIC_ROLE_COLUMNS)
        .from(adminRoles)
        .where(eq(adminRoles.id, id))

      const now = new Date()
      const updateSet: Record<string, unknown> = {
        updated_at: now,
        vid: sql`${adminRoles.vid} + 1`,
      }
      if (patch.name !== undefined) updateSet.name = patch.name
      if (patch.description !== undefined) updateSet.description = patch.description
      if (patch.order !== undefined) updateSet.order = patch.order

      const result = await db
        .update(adminRoles)
        .set(updateSet)
        .where(and(eq(adminRoles.id, id), eq(adminRoles.vid, expectedVid)))
      if (affectedRowCount(result) === 0 || !current) throw ERR_ADMIN_ROLE_VERSION_CONFLICT()

      return {
        ...current,
        name: patch.name !== undefined ? patch.name : current.name,
        description: patch.description !== undefined ? patch.description : current.description,
        order: patch.order !== undefined ? patch.order : current.order,
        vid: expectedVid + 1,
        updated_at: now,
      }
    },

    async delete(id, expectedVid) {
      // Cascades remove role ↔ user assignments and per-role permissions
      // (`ON DELETE CASCADE` on both FKs — see `database/schema/auth.ts`).
      const result = await db
        .delete(adminRoles)
        .where(and(eq(adminRoles.id, id), eq(adminRoles.vid, expectedVid)))
      if (affectedRowCount(result) === 0) throw ERR_ADMIN_ROLE_VERSION_CONFLICT()
    },

    async reorder(ids) {
      if (ids.length === 0) return
      // Single transaction so the list is never observed half-reordered.
      // No vid gate: see `AdminRolesRepository.reorder` contract docs.
      await db.transaction(async (tx) => {
        const now = new Date()
        for (let i = 0; i < ids.length; i++) {
          await tx
            .update(adminRoles)
            .set({
              order: i,
              updated_at: now,
              vid: sql`${adminRoles.vid} + 1`,
            })
            .where(eq(adminRoles.id, ids[i] as string))
        }
      })
    },

    // -----------------------------------------------------------------
    // Role ↔ user assignments
    // -----------------------------------------------------------------

    async assignToUser(roleId, userId) {
      await db
        .insert(adminRoleAdminUser)
        .values({ admin_role_id: roleId, admin_user_id: userId })
        .onDuplicateKeyUpdate({
          set: { admin_role_id: sql`admin_role_id` },
        })
    },

    async unassignFromUser(roleId, userId) {
      await db
        .delete(adminRoleAdminUser)
        .where(
          and(
            eq(adminRoleAdminUser.admin_role_id, roleId),
            eq(adminRoleAdminUser.admin_user_id, userId)
          )
        )
    },

    async listRolesForUser(userId) {
      const rows = await db
        .select(PUBLIC_ROLE_COLUMNS)
        .from(adminRoles)
        .innerJoin(adminRoleAdminUser, eq(adminRoleAdminUser.admin_role_id, adminRoles.id))
        .where(eq(adminRoleAdminUser.admin_user_id, userId))
        .orderBy(asc(adminRoles.order))
      return rows
    },

    async listUsersForRole(roleId) {
      const rows = await db
        .select({ admin_user_id: adminRoleAdminUser.admin_user_id })
        .from(adminRoleAdminUser)
        .where(eq(adminRoleAdminUser.admin_role_id, roleId))
      return rows.map((r) => r.admin_user_id)
    },

    async setRolesForUser(userId, roleIds) {
      // Single transaction — user assignments are never observed
      // half-edited. Symmetric to AdminPermissionsRepository.setAbilities.
      await db.transaction(async (tx) => {
        await tx.delete(adminRoleAdminUser).where(eq(adminRoleAdminUser.admin_user_id, userId))
        if (roleIds.length === 0) return
        const rows = roleIds.map((admin_role_id) => ({
          admin_role_id,
          admin_user_id: userId,
        }))
        await tx.insert(adminRoleAdminUser).values(rows)
      })
    },
  }
}
