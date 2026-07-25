/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { RefreshTokenRow, RefreshTokensRepository } from '@byline/admin/auth'
import { and, eq, isNull, lt } from 'drizzle-orm'
import type { MySql2Database } from 'drizzle-orm/mysql2'

import { adminRefreshTokens } from '../../database/schema/auth.js'
import { affectedRowCount } from '../storage/storage-utils.js'
import type * as schema from '../../database/schema/index.js'

/**
 * MySQL implementation of `RefreshTokensRepository`, backing the built-in
 * `JwtSessionProvider`. Ported from
 * `packages/db-postgres/src/modules/admin/refresh-tokens-repository.ts`.
 *
 * `issue()`'s `.returning()` has no MySQL equivalent. Every field
 * `RefreshTokenRow` exposes is either caller-supplied (`id`, `admin_user_id`,
 * `token_hash`, `expires_at`, `user_agent`, `ip`) or a fresh row's literal
 * default (`revoked_at`/`rotated_to_id`/`last_used_at` all `null`) — except
 * `issued_at`, which the schema defaults to `CURRENT_TIMESTAMP(6)`. Rather
 * than let the insert rely on that default and approximate the returned
 * value with a second, independent `new Date()` call (the drift the Task 9
 * deferred-minor note flags), `issued_at` — and the underlying table's
 * `created_at`/`updated_at`, which `RefreshTokenRow` doesn't expose but
 * which exist on the row — are set explicitly from one `now` captured
 * before the insert and reused for the returned row, so there is no gap
 * between what is persisted and what is returned. No re-`SELECT` needed.
 *
 * `revokeAllForUser` and `purgeExpired` only ever consumed
 * `.returning({ id })` for its `.length` (the affected-row count); MySQL's
 * driver result surfaces that directly via `affectedRows` — no row
 * reconstruction needed at all.
 */
export function createRefreshTokensRepository(
  db: MySql2Database<typeof schema>
): RefreshTokensRepository {
  return {
    async issue(input): Promise<RefreshTokenRow> {
      const now = new Date()
      const row: RefreshTokenRow = {
        id: input.id,
        admin_user_id: input.admin_user_id,
        token_hash: input.token_hash,
        issued_at: now,
        expires_at: input.expires_at,
        revoked_at: null,
        rotated_to_id: null,
        last_used_at: null,
        user_agent: input.user_agent ?? null,
        ip: input.ip ?? null,
      }
      await db.insert(adminRefreshTokens).values({
        id: row.id,
        admin_user_id: row.admin_user_id,
        token_hash: row.token_hash,
        issued_at: now,
        expires_at: row.expires_at,
        user_agent: row.user_agent,
        ip: row.ip,
        created_at: now,
        updated_at: now,
      })
      return row
    },

    async findByHash(tokenHash) {
      const [row] = await db
        .select()
        .from(adminRefreshTokens)
        .where(eq(adminRefreshTokens.token_hash, tokenHash))
      return row ?? null
    },

    async findById(id) {
      const [row] = await db.select().from(adminRefreshTokens).where(eq(adminRefreshTokens.id, id))
      return row ?? null
    },

    async touch(id, at = new Date()) {
      await db
        .update(adminRefreshTokens)
        .set({ last_used_at: at, updated_at: new Date() })
        .where(eq(adminRefreshTokens.id, id))
    },

    async markRotated(oldId, newId, at = new Date()) {
      await db
        .update(adminRefreshTokens)
        .set({ revoked_at: at, rotated_to_id: newId, updated_at: new Date() })
        .where(eq(adminRefreshTokens.id, oldId))
    },

    async revoke(id, at = new Date()) {
      await db
        .update(adminRefreshTokens)
        .set({ revoked_at: at, updated_at: new Date() })
        .where(and(eq(adminRefreshTokens.id, id), isNull(adminRefreshTokens.revoked_at)))
    },

    async revokeChain(startId, at = new Date()) {
      let cursor: string | null = startId
      let touched = 0
      // Bounded walk — chains in practice are short; 1000 is a safety ceiling.
      for (let step = 0; cursor != null && step < 1000; step++) {
        const [row] = await db
          .select({
            id: adminRefreshTokens.id,
            rotated_to_id: adminRefreshTokens.rotated_to_id,
            revoked_at: adminRefreshTokens.revoked_at,
          })
          .from(adminRefreshTokens)
          .where(eq(adminRefreshTokens.id, cursor))
        if (!row) break

        if (row.revoked_at == null) {
          await db
            .update(adminRefreshTokens)
            .set({ revoked_at: at, updated_at: new Date() })
            .where(eq(adminRefreshTokens.id, row.id))
          touched++
        }

        cursor = row.rotated_to_id
      }
      return touched
    },

    async revokeAllForUser(adminUserId, at = new Date()) {
      const result = await db
        .update(adminRefreshTokens)
        .set({ revoked_at: at, updated_at: new Date() })
        .where(
          and(
            eq(adminRefreshTokens.admin_user_id, adminUserId),
            isNull(adminRefreshTokens.revoked_at)
          )
        )
      return affectedRowCount(result)
    },

    async purgeExpired(now = new Date()) {
      const result = await db
        .delete(adminRefreshTokens)
        .where(lt(adminRefreshTokens.expires_at, now))
      return affectedRowCount(result)
    },

    async listActiveForUser(adminUserId) {
      return db
        .select()
        .from(adminRefreshTokens)
        .where(
          and(
            eq(adminRefreshTokens.admin_user_id, adminUserId),
            isNull(adminRefreshTokens.revoked_at)
          )
        )
    },

    async listAllForUser(adminUserId) {
      return db
        .select()
        .from(adminRefreshTokens)
        .where(eq(adminRefreshTokens.admin_user_id, adminUserId))
        .orderBy(adminRefreshTokens.issued_at)
    },

    async listRotationChain(startId) {
      const chain: RefreshTokenRow[] = []
      let cursor: string | null = startId
      for (let step = 0; cursor != null && step < 1000; step++) {
        const [row] = await db
          .select()
          .from(adminRefreshTokens)
          .where(eq(adminRefreshTokens.id, cursor))
        if (!row) break
        chain.push(row)
        cursor = row.rotated_to_id
      }
      return chain
    },
  }
}
