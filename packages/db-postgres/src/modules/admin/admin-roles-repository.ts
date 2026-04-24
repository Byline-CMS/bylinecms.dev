/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AdminRoleRow, AdminRolesRepository } from '@byline/admin/admin-roles'
import { and, eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { v7 as uuidv7 } from 'uuid'

import { adminRoleAdminUser, adminRoles } from '../../database/schema/auth.js'
import type * as schema from '../../database/schema/index.js'

/**
 * Postgres implementation of `AdminRolesRepository` — role CRUD and
 * role ↔ user assignments. Ability grants live on
 * `AdminPermissionsRepository` (see `admin-permissions-repository.ts`).
 */

const PUBLIC_ROLE_COLUMNS = {
  id: adminRoles.id,
  name: adminRoles.name,
  machine_name: adminRoles.machine_name,
  description: adminRoles.description,
  order: adminRoles.order,
  created_at: adminRoles.created_at,
  updated_at: adminRoles.updated_at,
} as const

export function createAdminRolesRepository(
  db: NodePgDatabase<typeof schema>
): AdminRolesRepository {
  return {
    // -----------------------------------------------------------------
    // Role CRUD
    // -----------------------------------------------------------------

    async create(input): Promise<AdminRoleRow> {
      const [row] = await db
        .insert(adminRoles)
        .values({
          id: uuidv7(),
          name: input.name,
          machine_name: input.machine_name,
          description: input.description ?? null,
          order: input.order ?? 0,
        })
        .returning(PUBLIC_ROLE_COLUMNS)
      if (!row) throw new Error('createAdminRole: insert returned no row')
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
      return db.select(PUBLIC_ROLE_COLUMNS).from(adminRoles).orderBy(adminRoles.order)
    },

    async update(id, patch): Promise<AdminRoleRow> {
      const updateSet: Record<string, unknown> = { updated_at: new Date() }
      if (patch.name !== undefined) updateSet.name = patch.name
      if (patch.description !== undefined) updateSet.description = patch.description
      if (patch.order !== undefined) updateSet.order = patch.order

      const [row] = await db
        .update(adminRoles)
        .set(updateSet)
        .where(eq(adminRoles.id, id))
        .returning(PUBLIC_ROLE_COLUMNS)
      if (!row) throw new Error(`updateAdminRole: no row found for id ${id}`)
      return row
    },

    async delete(id) {
      // Cascades remove role ↔ user assignments and per-role permissions.
      await db.delete(adminRoles).where(eq(adminRoles.id, id))
    },

    // -----------------------------------------------------------------
    // Role ↔ user assignments
    // -----------------------------------------------------------------

    async assignToUser(roleId, userId) {
      await db
        .insert(adminRoleAdminUser)
        .values({ admin_role_id: roleId, admin_user_id: userId })
        .onConflictDoNothing({
          target: [adminRoleAdminUser.admin_role_id, adminRoleAdminUser.admin_user_id],
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
        .orderBy(adminRoles.order)
      return rows
    },

    async listUsersForRole(roleId) {
      const rows = await db
        .select({ admin_user_id: adminRoleAdminUser.admin_user_id })
        .from(adminRoleAdminUser)
        .where(eq(adminRoleAdminUser.admin_role_id, roleId))
      return rows.map((r) => r.admin_user_id)
    },
  }
}
