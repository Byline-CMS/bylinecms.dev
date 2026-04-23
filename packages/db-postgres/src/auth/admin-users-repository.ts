/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { v7 as uuidv7 } from 'uuid'

import { bylineAdminUsers } from '../database/schema/auth.js'
import { hashPassword } from './password.js'
import type * as schema from '../database/schema/index.js'

/**
 * Public-facing admin-user row — the `password` column is deliberately
 * omitted. Only `getByEmailForSignIn` returns the password, and only so
 * the session provider can verify it.
 */
export interface AdminUserRow {
  id: string
  given_name: string | null
  family_name: string | null
  username: string | null
  email: string
  remember_me: boolean
  last_login: Date | null
  last_login_ip: string | null
  failed_login_attempts: number
  is_super_admin: boolean
  is_enabled: boolean
  is_email_verified: boolean
  created_at: Date
  updated_at: Date
}

/**
 * Admin-user row including the PHC password string. Returned only by
 * `getByEmailForSignIn` — callers must treat it with care (never log,
 * never return to clients).
 */
export interface AdminUserWithPasswordRow extends AdminUserRow {
  password: string
}

const PUBLIC_COLUMNS = {
  id: bylineAdminUsers.id,
  given_name: bylineAdminUsers.given_name,
  family_name: bylineAdminUsers.family_name,
  username: bylineAdminUsers.username,
  email: bylineAdminUsers.email,
  remember_me: bylineAdminUsers.remember_me,
  last_login: bylineAdminUsers.last_login,
  last_login_ip: bylineAdminUsers.last_login_ip,
  failed_login_attempts: bylineAdminUsers.failed_login_attempts,
  is_super_admin: bylineAdminUsers.is_super_admin,
  is_enabled: bylineAdminUsers.is_enabled,
  is_email_verified: bylineAdminUsers.is_email_verified,
  created_at: bylineAdminUsers.created_at,
  updated_at: bylineAdminUsers.updated_at,
} as const

export interface CreateAdminUserInput {
  email: string
  /** Plaintext. Hashed before insert. */
  password: string
  given_name?: string | null
  family_name?: string | null
  username?: string | null
  is_super_admin?: boolean
  is_enabled?: boolean
  is_email_verified?: boolean
}

export interface UpdateAdminUserInput {
  given_name?: string | null
  family_name?: string | null
  username?: string | null
  email?: string
  is_super_admin?: boolean
  is_enabled?: boolean
  is_email_verified?: boolean
  remember_me?: boolean
}

export function createAdminUsersRepository(db: NodePgDatabase<typeof schema>) {
  return {
    async create(input: CreateAdminUserInput): Promise<AdminUserRow> {
      const passwordHash = await hashPassword(input.password)
      const [row] = await db
        .insert(bylineAdminUsers)
        .values({
          id: uuidv7(),
          email: input.email.toLowerCase(),
          password: passwordHash,
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

    async getById(id: string): Promise<AdminUserRow | null> {
      const [row] = await db
        .select(PUBLIC_COLUMNS)
        .from(bylineAdminUsers)
        .where(eq(bylineAdminUsers.id, id))
      return row ?? null
    },

    async getByEmail(email: string): Promise<AdminUserRow | null> {
      const [row] = await db
        .select(PUBLIC_COLUMNS)
        .from(bylineAdminUsers)
        .where(eq(bylineAdminUsers.email, email.toLowerCase()))
      return row ?? null
    },

    async getByUsername(username: string): Promise<AdminUserRow | null> {
      const [row] = await db
        .select(PUBLIC_COLUMNS)
        .from(bylineAdminUsers)
        .where(eq(bylineAdminUsers.username, username))
      return row ?? null
    },

    /**
     * Sign-in-only lookup. Returns the password PHC string alongside the
     * public row so the session provider can verify. Callers **must not**
     * persist or echo the password field.
     */
    async getByEmailForSignIn(email: string): Promise<AdminUserWithPasswordRow | null> {
      const [row] = await db
        .select({ ...PUBLIC_COLUMNS, password: bylineAdminUsers.password })
        .from(bylineAdminUsers)
        .where(eq(bylineAdminUsers.email, email.toLowerCase()))
      return row ?? null
    },

    async update(id: string, patch: UpdateAdminUserInput): Promise<AdminUserRow> {
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
        .update(bylineAdminUsers)
        .set(updateSet)
        .where(eq(bylineAdminUsers.id, id))
        .returning(PUBLIC_COLUMNS)
      if (!row) throw new Error(`updateAdminUser: no row found for id ${id}`)
      return row
    },

    async setPassword(id: string, plaintext: string): Promise<void> {
      const passwordHash = await hashPassword(plaintext)
      await db
        .update(bylineAdminUsers)
        .set({ password: passwordHash, updated_at: new Date() })
        .where(eq(bylineAdminUsers.id, id))
    },

    async setEnabled(id: string, enabled: boolean): Promise<void> {
      await db
        .update(bylineAdminUsers)
        .set({ is_enabled: enabled, updated_at: new Date() })
        .where(eq(bylineAdminUsers.id, id))
    },

    async recordLoginSuccess(id: string, ip: string | null): Promise<void> {
      await db
        .update(bylineAdminUsers)
        .set({
          last_login: new Date(),
          last_login_ip: ip,
          failed_login_attempts: 0,
          updated_at: new Date(),
        })
        .where(eq(bylineAdminUsers.id, id))
    },

    async recordLoginFailure(id: string): Promise<void> {
      await db
        .update(bylineAdminUsers)
        .set({
          failed_login_attempts: sql`${bylineAdminUsers.failed_login_attempts} + 1`,
          updated_at: new Date(),
        })
        .where(eq(bylineAdminUsers.id, id))
    },

    async delete(id: string): Promise<void> {
      await db.delete(bylineAdminUsers).where(eq(bylineAdminUsers.id, id))
    },
  }
}

export type AdminUsersRepository = ReturnType<typeof createAdminUsersRepository>
