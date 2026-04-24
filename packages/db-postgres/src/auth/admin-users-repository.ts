/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AdminUserRow, AdminUsersRepository } from '@byline/admin/admin-users'
import { eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { v7 as uuidv7 } from 'uuid'

import { adminUsers } from '../database/schema/auth.js'
import type * as schema from '../database/schema/index.js'

/**
 * Postgres implementation of `AdminUsersRepository`.
 *
 * The DB column for the password hash is `password`; the public interface
 * exposes it as `password_hash`. The mapping happens entirely inside this
 * factory — callers speak the interface shape and never see the column
 * name.
 *
 * Password hashing is *not* done here — the interface takes a pre-hashed
 * PHC string. Callers (seed, admin-user commands) hash first via
 * `hashPassword` from `@byline/admin/auth`.
 */

const PUBLIC_COLUMNS = {
  id: adminUsers.id,
  given_name: adminUsers.given_name,
  family_name: adminUsers.family_name,
  username: adminUsers.username,
  email: adminUsers.email,
  remember_me: adminUsers.remember_me,
  last_login: adminUsers.last_login,
  last_login_ip: adminUsers.last_login_ip,
  failed_login_attempts: adminUsers.failed_login_attempts,
  is_super_admin: adminUsers.is_super_admin,
  is_enabled: adminUsers.is_enabled,
  is_email_verified: adminUsers.is_email_verified,
  created_at: adminUsers.created_at,
  updated_at: adminUsers.updated_at,
} as const

export function createAdminUsersRepository(
  db: NodePgDatabase<typeof schema>
): AdminUsersRepository {
  return {
    async create(input): Promise<AdminUserRow> {
      const [row] = await db
        .insert(adminUsers)
        .values({
          id: uuidv7(),
          email: input.email.toLowerCase(),
          password: input.password_hash,
          given_name: input.given_name ?? null,
          family_name: input.family_name ?? null,
          username: input.username ?? null,
          is_super_admin: input.is_super_admin ?? false,
          is_enabled: input.is_enabled ?? false,
          is_email_verified: input.is_email_verified ?? false,
        })
        .returning(PUBLIC_COLUMNS)
      if (!row) throw new Error('createAdminUser: insert returned no row')
      return row
    },

    async getById(id) {
      const [row] = await db.select(PUBLIC_COLUMNS).from(adminUsers).where(eq(adminUsers.id, id))
      return row ?? null
    },

    async getByEmail(email) {
      const [row] = await db
        .select(PUBLIC_COLUMNS)
        .from(adminUsers)
        .where(eq(adminUsers.email, email.toLowerCase()))
      return row ?? null
    },

    async getByUsername(username) {
      const [row] = await db
        .select(PUBLIC_COLUMNS)
        .from(adminUsers)
        .where(eq(adminUsers.username, username))
      return row ?? null
    },

    async getByEmailForSignIn(email) {
      const [row] = await db
        .select({ ...PUBLIC_COLUMNS, password_hash: adminUsers.password })
        .from(adminUsers)
        .where(eq(adminUsers.email, email.toLowerCase()))
      return row ?? null
    },

    async update(id, patch): Promise<AdminUserRow> {
      const updateSet: Record<string, unknown> = { updated_at: new Date() }
      if (patch.given_name !== undefined) updateSet.given_name = patch.given_name
      if (patch.family_name !== undefined) updateSet.family_name = patch.family_name
      if (patch.username !== undefined) updateSet.username = patch.username
      if (patch.email !== undefined) updateSet.email = patch.email.toLowerCase()
      if (patch.is_super_admin !== undefined) updateSet.is_super_admin = patch.is_super_admin
      if (patch.is_enabled !== undefined) updateSet.is_enabled = patch.is_enabled
      if (patch.is_email_verified !== undefined)
        updateSet.is_email_verified = patch.is_email_verified
      if (patch.remember_me !== undefined) updateSet.remember_me = patch.remember_me

      const [row] = await db
        .update(adminUsers)
        .set(updateSet)
        .where(eq(adminUsers.id, id))
        .returning(PUBLIC_COLUMNS)
      if (!row) throw new Error(`updateAdminUser: no row found for id ${id}`)
      return row
    },

    async setPasswordHash(id, passwordHash) {
      await db
        .update(adminUsers)
        .set({ password: passwordHash, updated_at: new Date() })
        .where(eq(adminUsers.id, id))
    },

    async setEnabled(id, enabled) {
      await db
        .update(adminUsers)
        .set({ is_enabled: enabled, updated_at: new Date() })
        .where(eq(adminUsers.id, id))
    },

    async recordLoginSuccess(id, ip) {
      await db
        .update(adminUsers)
        .set({
          last_login: new Date(),
          last_login_ip: ip,
          failed_login_attempts: 0,
          updated_at: new Date(),
        })
        .where(eq(adminUsers.id, id))
    },

    async recordLoginFailure(id) {
      await db
        .update(adminUsers)
        .set({
          failed_login_attempts: sql`${adminUsers.failed_login_attempts} + 1`,
          updated_at: new Date(),
        })
        .where(eq(adminUsers.id, id))
    },

    async delete(id) {
      await db.delete(adminUsers).where(eq(adminUsers.id, id))
    },
  }
}
