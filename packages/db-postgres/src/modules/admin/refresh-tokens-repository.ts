/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { RefreshTokenRow, RefreshTokensRepository } from '@byline/admin/auth'
import { and, eq, isNull, lt } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { adminRefreshTokens } from '../../database/schema/auth.js'
import type * as schema from '../../database/schema/index.js'

/**
 * Postgres implementation of `RefreshTokensRepository`, backing the
 * built-in `JwtSessionProvider`.
 */
export function createRefreshTokensRepository(
  db: NodePgDatabase<typeof schema>
): RefreshTokensRepository {
  return {
    async issue(input): Promise<RefreshTokenRow> {
      if (!Number.isSafeInteger(input.session_version) || input.session_version < -1) {
        throw new Error('issueRefreshToken: session_version must be an integer >= -1')
      }
      const [row] = await db
        .insert(adminRefreshTokens)
        .values({
          id: input.id,
          admin_user_id: input.admin_user_id,
          token_hash: input.token_hash,
          session_version: input.session_version,
          sid: input.sid ?? null,
          expires_at: input.expires_at,
          user_agent: input.user_agent ?? null,
          ip: input.ip ?? null,
        })
        .returning()
      if (!row) throw new Error('issueRefreshToken: insert returned no row')
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
      const [member] = await db
        .select()
        .from(adminRefreshTokens)
        .where(eq(adminRefreshTokens.id, startId))
      if (!member?.sid) return 0 // Legacy credentials fail closed in the provider.
      const result = await db
        .update(adminRefreshTokens)
        .set({ revoked_at: at, updated_at: at })
        .where(and(eq(adminRefreshTokens.sid, member.sid), isNull(adminRefreshTokens.revoked_at)))
        .returning({ id: adminRefreshTokens.id })
      return result.length
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
        .returning({ id: adminRefreshTokens.id })
      return result.length
    },

    async purgeExpired(now = new Date()) {
      const result = await db
        .delete(adminRefreshTokens)
        .where(lt(adminRefreshTokens.expires_at, now))
        .returning({ id: adminRefreshTokens.id })
      return result.length
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
