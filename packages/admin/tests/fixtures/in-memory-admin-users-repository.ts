/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { v7 as uuidv7 } from 'uuid'

import { ERR_ADMIN_USER_VERSION_CONFLICT } from '../../src/modules/admin-users/errors.js'
import type {
  AdminUserRow,
  AdminUsersRepository,
  CreateAdminUserInput,
  ListAdminUsersOptions,
  UpdateAdminUserInput,
} from '../../src/modules/admin-users/repository.js'

/**
 * In-memory `AdminUsersRepository` for unit tests.
 *
 * Preserves the observable contract of the Postgres implementation,
 * including `vid`-based optimistic concurrency on content writes.
 * `setEnabled` is vid-less (last-writer-wins for admin toggles) and
 * login counters do not bump `vid` (telemetry, not content).
 */

interface StoredRow extends AdminUserRow {
  password_hash: string
}

function matchesQuery(row: StoredRow, needle: string): boolean {
  const q = needle.toLowerCase()
  return (
    row.email.toLowerCase().includes(q) ||
    (row.given_name ?? '').toLowerCase().includes(q) ||
    (row.family_name ?? '').toLowerCase().includes(q) ||
    (row.username ?? '').toLowerCase().includes(q)
  )
}

function compareOrder(a: StoredRow, b: StoredRow, field: ListAdminUsersOptions['order']): number {
  const va = a[field] ?? ''
  const vb = b[field] ?? ''
  if (va instanceof Date && vb instanceof Date) return va.getTime() - vb.getTime()
  if (va < vb) return -1
  if (va > vb) return 1
  return 0
}

export function createInMemoryAdminUsersRepository(): AdminUsersRepository & {
  /** Escape-hatch for tests that want to seed rows directly. */
  __seed(row: StoredRow): void
  /** Escape-hatch to count rows for assertions. */
  __size(): number
} {
  const rows = new Map<string, StoredRow>()

  function strip(row: StoredRow): AdminUserRow {
    const { password_hash: _omit, ...rest } = row
    return rest
  }

  function now(): Date {
    return new Date()
  }

  return {
    __seed(row) {
      rows.set(row.id, row)
    },
    __size() {
      return rows.size
    },

    async create(input: CreateAdminUserInput): Promise<AdminUserRow> {
      const id = uuidv7()
      const t = now()
      const row: StoredRow = {
        id,
        vid: 1,
        email: input.email.toLowerCase(),
        password_hash: input.password_hash,
        given_name: input.given_name ?? null,
        family_name: input.family_name ?? null,
        username: input.username ?? null,
        remember_me: false,
        last_login: null,
        last_login_ip: null,
        failed_login_attempts: 0,
        is_super_admin: input.is_super_admin ?? false,
        is_enabled: input.is_enabled ?? false,
        is_email_verified: input.is_email_verified ?? false,
        created_at: t,
        updated_at: t,
      }
      rows.set(id, row)
      return strip(row)
    },

    async getById(id) {
      const row = rows.get(id)
      return row ? strip(row) : null
    },

    async getByEmail(email) {
      const needle = email.toLowerCase()
      for (const row of rows.values()) {
        if (row.email === needle) return strip(row)
      }
      return null
    },

    async getByUsername(username) {
      for (const row of rows.values()) {
        if (row.username === username) return strip(row)
      }
      return null
    },

    async getByEmailForSignIn(email) {
      const needle = email.toLowerCase()
      for (const row of rows.values()) {
        if (row.email === needle) return { ...row }
      }
      return null
    },

    async list(options) {
      const needle = options.query?.trim()
      const filtered =
        needle && needle.length > 0
          ? Array.from(rows.values()).filter((r) => matchesQuery(r, needle))
          : Array.from(rows.values())
      filtered.sort((a, b) => compareOrder(a, b, options.order) * (options.desc ? -1 : 1))
      const offset = Math.max(0, (options.page - 1) * options.pageSize)
      return filtered.slice(offset, offset + options.pageSize).map(strip)
    },

    async count(options) {
      const needle = options?.query?.trim()
      if (!needle) return rows.size
      let n = 0
      for (const row of rows.values()) {
        if (matchesQuery(row, needle)) n++
      }
      return n
    },

    async update(id, expectedVid, patch: UpdateAdminUserInput): Promise<AdminUserRow> {
      const existing = rows.get(id)
      if (!existing || existing.vid !== expectedVid) throw ERR_ADMIN_USER_VERSION_CONFLICT()
      const updated: StoredRow = {
        ...existing,
        ...(patch.email !== undefined ? { email: patch.email.toLowerCase() } : null),
        ...(patch.given_name !== undefined ? { given_name: patch.given_name } : null),
        ...(patch.family_name !== undefined ? { family_name: patch.family_name } : null),
        ...(patch.username !== undefined ? { username: patch.username } : null),
        ...(patch.is_super_admin !== undefined ? { is_super_admin: patch.is_super_admin } : null),
        ...(patch.is_enabled !== undefined ? { is_enabled: patch.is_enabled } : null),
        ...(patch.is_email_verified !== undefined
          ? { is_email_verified: patch.is_email_verified }
          : null),
        ...(patch.remember_me !== undefined ? { remember_me: patch.remember_me } : null),
        vid: existing.vid + 1,
        updated_at: now(),
      }
      rows.set(id, updated)
      return strip(updated)
    },

    async setPasswordHash(id, expectedVid, passwordHash): Promise<AdminUserRow> {
      const existing = rows.get(id)
      if (!existing || existing.vid !== expectedVid) throw ERR_ADMIN_USER_VERSION_CONFLICT()
      const updated: StoredRow = {
        ...existing,
        password_hash: passwordHash,
        vid: existing.vid + 1,
        updated_at: now(),
      }
      rows.set(id, updated)
      return strip(updated)
    },

    async setEnabled(id, enabled) {
      const existing = rows.get(id)
      if (!existing) return
      rows.set(id, {
        ...existing,
        is_enabled: enabled,
        vid: existing.vid + 1,
        updated_at: now(),
      })
    },

    async recordLoginSuccess(id, ip) {
      const existing = rows.get(id)
      if (!existing) return
      rows.set(id, {
        ...existing,
        last_login: now(),
        last_login_ip: ip,
        failed_login_attempts: 0,
        updated_at: now(),
      })
    },

    async recordLoginFailure(id) {
      const existing = rows.get(id)
      if (!existing) return
      rows.set(id, {
        ...existing,
        failed_login_attempts: existing.failed_login_attempts + 1,
        updated_at: now(),
      })
    },

    async delete(id, expectedVid) {
      const existing = rows.get(id)
      if (!existing || existing.vid !== expectedVid) throw ERR_ADMIN_USER_VERSION_CONFLICT()
      rows.delete(id)
    },
  }
}
