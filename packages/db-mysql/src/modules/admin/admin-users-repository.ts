/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  type AdminUserRow,
  type AdminUsersRepository,
  ERR_ADMIN_USER_VERSION_CONFLICT,
} from '@byline/admin/admin-users'
import { and, asc, desc, eq, inArray, like, or, sql } from 'drizzle-orm'
import type { MySql2Database } from 'drizzle-orm/mysql2'
import { v7 as uuidv7 } from 'uuid'

import { adminUsers } from '../../database/schema/auth.js'
import type * as schema from '../../database/schema/index.js'

/**
 * MySQL implementation of `AdminUsersRepository`. Ported from
 * `packages/db-postgres/src/modules/admin/admin-users-repository.ts`.
 *
 * The DB column for the password hash is `password`; the public interface
 * exposes it as `password_hash`. The mapping happens entirely inside this
 * factory — callers speak the interface shape and never see the column
 * name.
 *
 * Password hashing is *not* done here — the interface takes a pre-hashed
 * PHC string. Callers (seed, admin-user commands) hash first via
 * `hashPassword` from `@byline/admin/auth`.
 *
 * Divergences from the pg source (found live, not assumed):
 *   - `ilike` → `like`. `byline_admin_users` (like every table in this
 *     schema) uses the database's default `utf8mb4_0900_ai_ci` collation,
 *     which is itself accent- *and* case-insensitive — confirmed against
 *     the live container with a throwaway table (`'Alice@Example.com'`
 *     matched `LIKE '%alice%'`). So a plain `like()` already reproduces
 *     `ilike()`'s behaviour; MySQL has no `ILIKE` keyword to reach for.
 *   - `count(*)::int` → `CAST(COUNT(*) AS SIGNED)`, with a `Number()`
 *     normalisation at the result edge — mirrors the identical conversion
 *     in `storage-queries.ts` (mysql2 can return `BIGINT` aggregates as
 *     strings).
 *   - `.returning()` (4 sites: `create`, `update`, `setPasswordHash`,
 *     `delete`) → MySQL has no `RETURNING`. `create`'s id is app-generated
 *     UUIDv7 and every other column is either caller-supplied or a literal
 *     default, so the row is constructed in JS directly — the `created_at`/
 *     `updated_at` pair is captured once as `now` and used for *both* the
 *     `INSERT` values and the returned row, so there is no drift between
 *     what is persisted and what is returned (the failure mode the Task 9
 *     deferred-minor note warns about: two independent `new Date()` calls
 *     that can disagree). `update` and `setPasswordHash` return the full
 *     public row, including columns the patch didn't touch — those values
 *     aren't knowable from the patch alone, so both read the current row
 *     first and merge the patch onto it in JS. This pre-read does not
 *     weaken the optimistic-concurrency guarantee: the accept/reject
 *     decision is still made entirely by the vid-guarded `UPDATE`'s
 *     affected-row count, exactly as pg's guarded `UPDATE … RETURNING`
 *     does — a stale pre-read can only cause the guarded `UPDATE` to affect
 *     zero rows (correctly rejected), never a false accept. `delete` needs
 *     no pre-read at all — it returns `void`, so the affected-row count is
 *     the entire contract.
 */

const PUBLIC_COLUMNS = {
  id: adminUsers.id,
  vid: adminUsers.vid,
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
  preferred_locale: adminUsers.preferred_locale,
  created_at: adminUsers.created_at,
  updated_at: adminUsers.updated_at,
} as const

const ORDER_COLUMN = {
  given_name: adminUsers.given_name,
  family_name: adminUsers.family_name,
  email: adminUsers.email,
  username: adminUsers.username,
  created_at: adminUsers.created_at,
  updated_at: adminUsers.updated_at,
} as const

function affectedRowCount(result: unknown): number {
  return (result as [{ affectedRows: number }, unknown])[0]?.affectedRows ?? 0
}

export function createAdminUsersRepository(
  db: MySql2Database<typeof schema>
): AdminUsersRepository {
  return {
    async create(input): Promise<AdminUserRow> {
      const id = uuidv7()
      const now = new Date()
      const row: AdminUserRow = {
        id,
        vid: 1,
        given_name: input.given_name ?? null,
        family_name: input.family_name ?? null,
        username: input.username ?? null,
        email: input.email.toLowerCase(),
        remember_me: false,
        last_login: null,
        last_login_ip: null,
        failed_login_attempts: 0,
        is_super_admin: input.is_super_admin ?? false,
        is_enabled: input.is_enabled ?? false,
        is_email_verified: input.is_email_verified ?? false,
        preferred_locale: input.preferred_locale ?? null,
        created_at: now,
        updated_at: now,
      }
      await db.insert(adminUsers).values({
        id: row.id,
        email: row.email,
        password: input.password_hash,
        given_name: row.given_name,
        family_name: row.family_name,
        username: row.username,
        is_super_admin: row.is_super_admin,
        is_enabled: row.is_enabled,
        is_email_verified: row.is_email_verified,
        preferred_locale: row.preferred_locale,
        created_at: now,
        updated_at: now,
      })
      return row
    },

    async getById(id) {
      const [row] = await db.select(PUBLIC_COLUMNS).from(adminUsers).where(eq(adminUsers.id, id))
      return row ?? null
    },

    async getByIds(ids) {
      if (ids.length === 0) return []
      return db.select(PUBLIC_COLUMNS).from(adminUsers).where(inArray(adminUsers.id, ids))
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

    async getByIdForSignIn(id) {
      const [row] = await db
        .select({ ...PUBLIC_COLUMNS, password_hash: adminUsers.password })
        .from(adminUsers)
        .where(eq(adminUsers.id, id))
      return row ?? null
    },

    async list(options) {
      const needle = options.query?.trim()
      const filter =
        needle && needle.length > 0
          ? or(
              like(adminUsers.email, `%${needle}%`),
              like(adminUsers.given_name, `%${needle}%`),
              like(adminUsers.family_name, `%${needle}%`),
              like(adminUsers.username, `%${needle}%`)
            )
          : undefined

      const sortCol = ORDER_COLUMN[options.order]
      const orderExpr = options.desc ? desc(sortCol) : asc(sortCol)
      const offset = Math.max(0, (options.page - 1) * options.pageSize)

      const query = db.select(PUBLIC_COLUMNS).from(adminUsers)
      const filtered = filter ? query.where(filter) : query
      return filtered.orderBy(orderExpr).limit(options.pageSize).offset(offset)
    },

    async count(options) {
      const needle = options?.query?.trim()
      const filter =
        needle && needle.length > 0
          ? or(
              like(adminUsers.email, `%${needle}%`),
              like(adminUsers.given_name, `%${needle}%`),
              like(adminUsers.family_name, `%${needle}%`),
              like(adminUsers.username, `%${needle}%`)
            )
          : undefined

      const base = db.select({ value: sql<number>`CAST(COUNT(*) AS SIGNED)` }).from(adminUsers)
      const [row] = await (filter ? base.where(filter) : base)
      return Number(row?.value ?? 0)
    },

    async update(id, expectedVid, patch): Promise<AdminUserRow> {
      const [current] = await db
        .select(PUBLIC_COLUMNS)
        .from(adminUsers)
        .where(eq(adminUsers.id, id))

      const now = new Date()
      const updateSet: Record<string, unknown> = {
        updated_at: now,
        vid: sql`${adminUsers.vid} + 1`,
      }
      if (patch.given_name !== undefined) updateSet.given_name = patch.given_name
      if (patch.family_name !== undefined) updateSet.family_name = patch.family_name
      if (patch.username !== undefined) updateSet.username = patch.username
      if (patch.email !== undefined) updateSet.email = patch.email.toLowerCase()
      if (patch.is_super_admin !== undefined) updateSet.is_super_admin = patch.is_super_admin
      if (patch.is_enabled !== undefined) updateSet.is_enabled = patch.is_enabled
      if (patch.is_email_verified !== undefined)
        updateSet.is_email_verified = patch.is_email_verified
      if (patch.remember_me !== undefined) updateSet.remember_me = patch.remember_me
      if (patch.preferred_locale !== undefined) updateSet.preferred_locale = patch.preferred_locale

      const result = await db
        .update(adminUsers)
        .set(updateSet)
        .where(and(eq(adminUsers.id, id), eq(adminUsers.vid, expectedVid)))
      if (affectedRowCount(result) === 0 || !current) throw ERR_ADMIN_USER_VERSION_CONFLICT()

      return {
        ...current,
        given_name: patch.given_name !== undefined ? patch.given_name : current.given_name,
        family_name: patch.family_name !== undefined ? patch.family_name : current.family_name,
        username: patch.username !== undefined ? patch.username : current.username,
        email: patch.email !== undefined ? patch.email.toLowerCase() : current.email,
        is_super_admin:
          patch.is_super_admin !== undefined ? patch.is_super_admin : current.is_super_admin,
        is_enabled: patch.is_enabled !== undefined ? patch.is_enabled : current.is_enabled,
        is_email_verified:
          patch.is_email_verified !== undefined
            ? patch.is_email_verified
            : current.is_email_verified,
        remember_me: patch.remember_me !== undefined ? patch.remember_me : current.remember_me,
        preferred_locale:
          patch.preferred_locale !== undefined ? patch.preferred_locale : current.preferred_locale,
        vid: expectedVid + 1,
        updated_at: now,
      }
    },

    async setPasswordHash(id, expectedVid, passwordHash): Promise<AdminUserRow> {
      const [current] = await db
        .select(PUBLIC_COLUMNS)
        .from(adminUsers)
        .where(eq(adminUsers.id, id))

      const now = new Date()
      const result = await db
        .update(adminUsers)
        .set({
          password: passwordHash,
          updated_at: now,
          vid: sql`${adminUsers.vid} + 1`,
        })
        .where(and(eq(adminUsers.id, id), eq(adminUsers.vid, expectedVid)))
      if (affectedRowCount(result) === 0 || !current) throw ERR_ADMIN_USER_VERSION_CONFLICT()

      return {
        ...current,
        vid: expectedVid + 1,
        updated_at: now,
      }
    },

    async setEnabled(id, enabled) {
      await db
        .update(adminUsers)
        .set({ is_enabled: enabled, updated_at: new Date(), vid: sql`${adminUsers.vid} + 1` })
        .where(eq(adminUsers.id, id))
    },

    async setPreferredLocale(id, locale) {
      await db
        .update(adminUsers)
        .set({ preferred_locale: locale, updated_at: new Date(), vid: sql`${adminUsers.vid} + 1` })
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

    async delete(id, expectedVid) {
      const result = await db
        .delete(adminUsers)
        .where(and(eq(adminUsers.id, id), eq(adminUsers.vid, expectedVid)))
      if (affectedRowCount(result) === 0) throw ERR_ADMIN_USER_VERSION_CONFLICT()
    },
  }
}
