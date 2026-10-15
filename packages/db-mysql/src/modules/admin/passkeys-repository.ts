/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  assertPasskeyAttempt,
  assertPasskeyBytes,
  assertPasskeyClaim,
  assertPasskeyTokenHash,
  type PasskeysRepository,
} from '@byline/admin/auth'
import { and, count, eq, gt, isNull, sql } from 'drizzle-orm'
import type { MySql2Database } from 'drizzle-orm/mysql2'
import { v7 as uuidv7 } from 'uuid'

import {
  adminLoginSessions,
  adminRefreshTokens,
  adminUsers,
  adminPasskeyAttempts as attempts,
  adminPasskeyCredentials as credentials,
} from '../../database/schema/auth.js'
import { auditLog } from '../../database/schema/index.js'
import type * as schema from '../../database/schema/index.js'

export function createPasskeysRepository(
  db: MySql2Database<typeof schema>,
  lockedAccounts: readonly string[] | null
): PasskeysRepository {
  function requireLock(id: string | null): void {
    if (id === null || !lockedAccounts?.includes(id))
      throw new Error('Passkey write requires the owning account lock')
  }
  async function requireCredentialLock(id: string): Promise<void> {
    const [row] = await db
      .select({ owner: credentials.admin_user_id })
      .from(credentials)
      .where(eq(credentials.id, id))
    if (!row) throw new Error('Passkey credential not found')
    requireLock(row.owner)
  }
  return {
    async invalidateAccountLogins(adminUserId, at) {
      requireLock(adminUserId)
      await db
        .update(adminUsers)
        .set({ session_version: sql`${adminUsers.session_version} + 1` })
        .where(eq(adminUsers.id, adminUserId))
      await db
        .update(adminLoginSessions)
        .set({ revoked_at: at })
        .where(
          and(
            eq(adminLoginSessions.admin_user_id, adminUserId),
            isNull(adminLoginSessions.revoked_at)
          )
        )
      await db
        .update(adminRefreshTokens)
        .set({ revoked_at: at })
        .where(
          and(
            eq(adminRefreshTokens.admin_user_id, adminUserId),
            isNull(adminRefreshTokens.revoked_at)
          )
        )
    },
    async appendRemovalAudit(input) {
      if (input.outcome === 'success') {
        requireLock(input.actorId)
        requireLock(input.targetId)
      }
      await db.insert(auditLog).values({
        id: uuidv7(),
        actor_id: input.actorId,
        actor_realm: 'admin',
        action: 'admin.passkey.remove',
        after: {
          targetUserId: input.targetId,
          credentialRecordId: input.credentialId,
          outcome: input.outcome,
        },
      })
    },
    async getUserHandle(adminUserId) {
      const [row] = await db
        .select({ handle: adminUsers.webauthn_user_handle })
        .from(adminUsers)
        .where(eq(adminUsers.id, adminUserId))
      return row?.handle ?? null
    },
    async ensureUserHandle(adminUserId, candidate) {
      requireLock(adminUserId)
      assertPasskeyBytes(candidate, 32, 32)
      await db
        .update(adminUsers)
        .set({ webauthn_user_handle: candidate })
        .where(and(eq(adminUsers.id, adminUserId), isNull(adminUsers.webauthn_user_handle)))
      const [row] = await db
        .select({ handle: adminUsers.webauthn_user_handle })
        .from(adminUsers)
        .where(eq(adminUsers.id, adminUserId))
      if (!row?.handle) throw new Error('Passkey account not found')
      return row.handle
    },
    async findCredential(id) {
      const [row] = await db.select().from(credentials).where(eq(credentials.id, id))
      return row ?? null
    },
    async findCredentialByCredentialId(credentialId) {
      assertPasskeyBytes(credentialId, 1024)
      const [row] = await db
        .select()
        .from(credentials)
        .where(eq(credentials.credential_id, credentialId))
      return row ?? null
    },
    async listCredentials(adminUserId) {
      return db
        .select()
        .from(credentials)
        .where(and(eq(credentials.admin_user_id, adminUserId), isNull(credentials.revoked_at)))
    },
    async createCredential(input) {
      requireLock(input.admin_user_id)
      assertPasskeyBytes(input.credential_id, 1024)
      assertPasskeyBytes(input.public_key, 8192)
      await db.insert(credentials).values(input)
    },
    async updateCredential(id, patch) {
      await requireCredentialLock(id)
      await db
        .update(credentials)
        .set(patch)
        .where(and(eq(credentials.id, id), isNull(credentials.revoked_at)))
    },
    async revokeCredential(id, at) {
      await requireCredentialLock(id)
      await db
        .update(credentials)
        .set({ revoked_at: at })
        .where(and(eq(credentials.id, id), isNull(credentials.revoked_at)))
    },
    async createAttempt(input) {
      assertPasskeyAttempt(input)
      if (input.purpose !== 'sign-in') requireLock(input.actor_user_id)
      await db.insert(attempts).values(input)
    },
    async findAttempt(tokenHash) {
      assertPasskeyTokenHash(tokenHash)
      const [row] = await db.select().from(attempts).where(eq(attempts.token_hash, tokenHash))
      return row ?? null
    },
    async countPendingForLogin(loginId, now) {
      const [row] = await db
        .select({ total: count() })
        .from(attempts)
        .where(
          and(
            eq(attempts.actor_login_id, loginId),
            isNull(attempts.consumed_at),
            gt(attempts.expires_at, now)
          )
        )
      return Number(row?.total ?? 0)
    },
    async claimAttempt(input) {
      if (lockedAccounts !== null)
        throw new Error('Passkey claims require a root store, outside account transactions')
      assertPasskeyClaim(input)
      const binding = input.binding
      const match = and(
        eq(attempts.token_hash, input.tokenHash),
        eq(attempts.purpose, input.purpose),
        isNull(attempts.consumed_at),
        gt(attempts.expires_at, input.now),
        binding.actor_user_id === null
          ? isNull(attempts.actor_user_id)
          : eq(attempts.actor_user_id, binding.actor_user_id),
        binding.actor_login_id === null
          ? isNull(attempts.actor_login_id)
          : eq(attempts.actor_login_id, binding.actor_login_id),
        binding.actor_generation === null
          ? isNull(attempts.actor_generation)
          : eq(attempts.actor_generation, binding.actor_generation),
        input.purpose === 'sign-in' ? isNull(attempts.action) : eq(attempts.action, input.action)
      )
      // The transaction promise resolves only after commit. No retry/savepoint path.
      return db.transaction(async (tx) => {
        const [result] = await tx.update(attempts).set({ consumed_at: input.now }).where(match)
        if (result.affectedRows !== 1) return null
        const [row] = await tx
          .select()
          .from(attempts)
          .where(eq(attempts.token_hash, input.tokenHash))
        if (!row) throw new Error('Claimed passkey attempt disappeared')
        return row
      })
    },
  }
}
