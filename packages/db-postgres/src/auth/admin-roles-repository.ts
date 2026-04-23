/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { and, eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { v7 as uuidv7 } from 'uuid'

import { adminPermissions, adminRoleAdminUser, adminRoles } from '../database/schema/auth.js'
import type * as schema from '../database/schema/index.js'

export interface AdminRoleRow {
  id: string
  name: string
  machine_name: string
  description: string | null
  order: number
  created_at: Date
  updated_at: Date
}

export interface CreateAdminRoleInput {
  name: string
  machine_name: string
  description?: string | null
  order?: number
}

export interface UpdateAdminRoleInput {
  name?: string
  description?: string | null
  order?: number
}

const PUBLIC_ROLE_COLUMNS = {
  id: adminRoles.id,
  name: adminRoles.name,
  machine_name: adminRoles.machine_name,
  description: adminRoles.description,
  order: adminRoles.order,
  created_at: adminRoles.created_at,
  updated_at: adminRoles.updated_at,
} as const

export function createAdminRolesRepository(db: NodePgDatabase<typeof schema>) {
  return {
    // -----------------------------------------------------------------
    // Role CRUD
    // -----------------------------------------------------------------

    async create(input: CreateAdminRoleInput): Promise<AdminRoleRow> {
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

    async getById(id: string): Promise<AdminRoleRow | null> {
      const [row] = await db
        .select(PUBLIC_ROLE_COLUMNS)
        .from(adminRoles)
        .where(eq(adminRoles.id, id))
      return row ?? null
    },

    async getByMachineName(machineName: string): Promise<AdminRoleRow | null> {
      const [row] = await db
        .select(PUBLIC_ROLE_COLUMNS)
        .from(adminRoles)
        .where(eq(adminRoles.machine_name, machineName))
      return row ?? null
    },

    async list(): Promise<AdminRoleRow[]> {
      return db.select(PUBLIC_ROLE_COLUMNS).from(adminRoles).orderBy(adminRoles.order)
    },

    async update(id: string, patch: UpdateAdminRoleInput): Promise<AdminRoleRow> {
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

    async delete(id: string): Promise<void> {
      // Cascades remove role ↔ user assignments and per-role permissions.
      await db.delete(adminRoles).where(eq(adminRoles.id, id))
    },

    // -----------------------------------------------------------------
    // Ability grants (role → ability strings)
    // -----------------------------------------------------------------

    /** Grant an ability to a role. Idempotent via the unique constraint. */
    async grantAbility(roleId: string, ability: string): Promise<void> {
      await db
        .insert(adminPermissions)
        .values({ id: uuidv7(), admin_role_id: roleId, ability })
        .onConflictDoNothing({
          target: [adminPermissions.admin_role_id, adminPermissions.ability],
        })
    },

    async revokeAbility(roleId: string, ability: string): Promise<void> {
      await db
        .delete(adminPermissions)
        .where(
          and(eq(adminPermissions.admin_role_id, roleId), eq(adminPermissions.ability, ability))
        )
    },

    async listAbilities(roleId: string): Promise<string[]> {
      const rows = await db
        .select({ ability: adminPermissions.ability })
        .from(adminPermissions)
        .where(eq(adminPermissions.admin_role_id, roleId))
      return rows.map((r) => r.ability)
    },

    /** Replace the ability set for a role wholesale. Runs inside a transaction. */
    async setAbilities(roleId: string, abilities: readonly string[]): Promise<void> {
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

    // -----------------------------------------------------------------
    // Role ↔ user assignments
    // -----------------------------------------------------------------

    /** Assign a role to a user. Idempotent via the composite primary key. */
    async assignToUser(roleId: string, userId: string): Promise<void> {
      await db
        .insert(adminRoleAdminUser)
        .values({ admin_role_id: roleId, admin_user_id: userId })
        .onConflictDoNothing({
          target: [adminRoleAdminUser.admin_role_id, adminRoleAdminUser.admin_user_id],
        })
    },

    async unassignFromUser(roleId: string, userId: string): Promise<void> {
      await db
        .delete(adminRoleAdminUser)
        .where(
          and(
            eq(adminRoleAdminUser.admin_role_id, roleId),
            eq(adminRoleAdminUser.admin_user_id, userId)
          )
        )
    },

    async listRolesForUser(userId: string): Promise<AdminRoleRow[]> {
      return db
        .select(PUBLIC_ROLE_COLUMNS)
        .from(adminRoles)
        .innerJoin(adminRoleAdminUser, eq(adminRoleAdminUser.admin_role_id, adminRoles.id))
        .where(eq(adminRoleAdminUser.admin_user_id, userId))
        .orderBy(adminRoles.order)
    },

    async listUsersForRole(roleId: string): Promise<string[]> {
      const rows = await db
        .select({ admin_user_id: adminRoleAdminUser.admin_user_id })
        .from(adminRoleAdminUser)
        .where(eq(adminRoleAdminUser.admin_role_id, roleId))
      return rows.map((r) => r.admin_user_id)
    },
  }
}

export type AdminRolesRepository = ReturnType<typeof createAdminRolesRepository>
