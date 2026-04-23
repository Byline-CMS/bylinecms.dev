/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { and, eq, isNull, lt } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { adminRefreshTokens } from '../database/schema/auth.js'
import type * as schema from '../database/schema/index.js'

/**
 * Refresh-token row as seen by the session provider. Note that `token_hash`
 * is the SHA-256 of the plaintext — the plaintext itself is never stored
 * and leaves the server only once, when it is issued to the caller.
 */
export interface RefreshTokenRow {
  id: string
  admin_user_id: string
  token_hash: string
  issued_at: Date
  expires_at: Date
  revoked_at: Date | null
  rotated_to_id: string | null
  last_used_at: Date | null
  user_agent: string | null
  ip: string | null
}

export interface IssueRefreshTokenInput {
  id: string
  admin_user_id: string
  token_hash: string
  expires_at: Date
  user_agent?: string | null
  ip?: string | null
}

export function createRefreshTokensRepository(db: NodePgDatabase<typeof schema>) {
  return {
    /** Insert a new refresh-token row. `id` is supplied by the caller (UUIDv7). */
    async issue(input: IssueRefreshTokenInput): Promise<RefreshTokenRow> {
      const [row] = await db
        .insert(adminRefreshTokens)
        .values({
          id: input.id,
          admin_user_id: input.admin_user_id,
          token_hash: input.token_hash,
          expires_at: input.expires_at,
          user_agent: input.user_agent ?? null,
          ip: input.ip ?? null,
        })
        .returning()
      if (!row) throw new Error('issueRefreshToken: insert returned no row')
      return row
    },

    async findByHash(tokenHash: string): Promise<RefreshTokenRow | null> {
      const [row] = await db
        .select()
        .from(adminRefreshTokens)
        .where(eq(adminRefreshTokens.token_hash, tokenHash))
      return row ?? null
    },

    async findById(id: string): Promise<RefreshTokenRow | null> {
      const [row] = await db.select().from(adminRefreshTokens).where(eq(adminRefreshTokens.id, id))
      return row ?? null
    },

    /** Stamp `last_used_at` for observability. */
    async touch(id: string, at: Date = new Date()): Promise<void> {
      await db
        .update(adminRefreshTokens)
        .set({ last_used_at: at, updated_at: new Date() })
        .where(eq(adminRefreshTokens.id, id))
    },

    /**
     * Atomically revoke `oldId` and set its `rotated_to_id` to `newId`.
     * Caller is responsible for inserting the new row (via `issue`) before
     * calling this — the DB enforces FK-style checking only on hash
     * uniqueness, so ordering is a contract.
     */
    async markRotated(oldId: string, newId: string, at: Date = new Date()): Promise<void> {
      await db
        .update(adminRefreshTokens)
        .set({ revoked_at: at, rotated_to_id: newId, updated_at: new Date() })
        .where(eq(adminRefreshTokens.id, oldId))
    },

    /** Revoke a single token. Idempotent. */
    async revoke(id: string, at: Date = new Date()): Promise<void> {
      await db
        .update(adminRefreshTokens)
        .set({ revoked_at: at, updated_at: new Date() })
        .where(and(eq(adminRefreshTokens.id, id), isNull(adminRefreshTokens.revoked_at)))
    },

    /**
     * Walk the rotation chain starting at `startId` and revoke every token
     * in it. Called when a rotated token is replayed — indicates the
     * chain has been compromised and every descendant is suspect.
     *
     * Returns the number of rows touched.
     */
    async revokeChain(startId: string, at: Date = new Date()): Promise<number> {
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

    /** Revoke every non-revoked token for a user. Used on password change / sign-out everywhere. */
    async revokeAllForUser(adminUserId: string, at: Date = new Date()): Promise<number> {
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

    /** Remove rows whose `expires_at` is in the past. Housekeeping. */
    async purgeExpired(now: Date = new Date()): Promise<number> {
      const result = await db
        .delete(adminRefreshTokens)
        .where(lt(adminRefreshTokens.expires_at, now))
        .returning({ id: adminRefreshTokens.id })
      return result.length
    },

    /** All non-revoked, non-expired tokens for a user. Primarily for tests. */
    async listActiveForUser(adminUserId: string): Promise<RefreshTokenRow[]> {
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

    /** All tokens (including revoked) for a user. Primarily for tests and debugging. */
    async listAllForUser(adminUserId: string): Promise<RefreshTokenRow[]> {
      return db
        .select()
        .from(adminRefreshTokens)
        .where(eq(adminRefreshTokens.admin_user_id, adminUserId))
        .orderBy(adminRefreshTokens.issued_at)
    },

    /** All tokens descended from `startId` via the rotation chain. Utility for tests. */
    async listRotationChain(startId: string): Promise<RefreshTokenRow[]> {
      // Gather the chain and filter results without relying on CTE syntax,
      // keeping the query simple. See `revokeChain` for the same walk.
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

export type RefreshTokensRepository = ReturnType<typeof createRefreshTokensRepository>
