/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AuthMaintenanceRepository } from '@byline/admin/auth'
import { and, eq, inArray, isNull, lte, notInArray } from 'drizzle-orm'
import type { MySql2Database } from 'drizzle-orm/mysql2'
import type { ResultSetHeader } from 'mysql2'

import {
  adminPasskeyAttempts as attempts,
  adminLoginSessions as logins,
  adminRefreshTokens as refresh,
} from '../../database/schema/auth.js'
import type * as schema from '../../database/schema/index.js'

export function createAuthMaintenanceRepository(
  db: MySql2Database<typeof schema>,
  lockedAccounts: readonly string[] | null
): AuthMaintenanceRepository {
  return {
    async purgeAttempts(before) {
      // Separate indexed scans avoid sorting or materializing an unbounded OR result.
      const expired = await db
        .select({ id: attempts.token_hash })
        .from(attempts)
        .where(lte(attempts.expires_at, before))
        .limit(100)
      const ids = expired.map((row) => row.id)
      if (ids.length < 100) {
        const consumed = await db
          .select({ id: attempts.token_hash })
          .from(attempts)
          .where(
            and(
              lte(attempts.consumed_at, before),
              ids.length ? notInArray(attempts.token_hash, ids) : undefined
            )
          )
          .limit(100 - ids.length)
        ids.push(...consumed.map((row) => row.id))
      }
      if (!ids.length) return 0
      const [removed] = await db.delete(attempts).where(inArray(attempts.token_hash, ids))
      return (removed as ResultSetHeader).affectedRows
    },
    async findTerminalLogin(before) {
      const projection = { id: logins.id, adminUserId: logins.admin_user_id }
      const [expired] = await db
        .select(projection)
        .from(logins)
        .where(lte(logins.expires_at, before))
        .limit(1)
      if (expired) return expired
      const [revoked] = await db
        .select(projection)
        .from(logins)
        .where(lte(logins.revoked_at, before))
        .limit(1)
      return revoked ?? null
    },
    async pruneTerminalLogin({ id, adminUserId, before }) {
      if (!lockedAccounts?.includes(adminUserId))
        throw new Error('Login cleanup requires the owning account lock')
      const [login] = await db
        .select()
        .from(logins)
        .where(and(eq(logins.id, id), eq(logins.admin_user_id, adminUserId)))
        .for('update')
      if (!login || (login.expires_at > before && (!login.revoked_at || login.revoked_at > before)))
        return { refreshDeleted: 0, loginDeleted: false }
      const children = await db
        .select({ id: refresh.id })
        .from(refresh)
        .where(eq(refresh.sid, id))
        .limit(100)
      let refreshDeleted = 0
      if (children.length) {
        const [removed] = await db.delete(refresh).where(
          inArray(
            refresh.id,
            children.map((row) => row.id)
          )
        )
        refreshDeleted = (removed as ResultSetHeader).affectedRows
      }
      const [remaining] = await db
        .select({ id: refresh.id })
        .from(refresh)
        .where(eq(refresh.sid, id))
        .limit(1)
      if (remaining) return { refreshDeleted, loginDeleted: false }
      // The account and login-row locks prevent native renewal or issuance from
      // adding children between this empty check and deletion. The FK cascade
      // has no work to do; the task never relies on it to drain a token family.
      await db.delete(logins).where(eq(logins.id, id))
      return { refreshDeleted, loginDeleted: true }
    },
    async purgeLegacyRefreshTokens(before) {
      const rows = await db
        .select({ id: refresh.id })
        .from(refresh)
        .where(and(isNull(refresh.sid), lte(refresh.expires_at, before)))
        .limit(100)
      if (!rows.length) return 0
      const [removed] = await db.delete(refresh).where(
        and(
          inArray(
            refresh.id,
            rows.map((row) => row.id)
          ),
          isNull(refresh.sid),
          lte(refresh.expires_at, before)
        )
      )
      return (removed as ResultSetHeader).affectedRows
    },
  }
}
