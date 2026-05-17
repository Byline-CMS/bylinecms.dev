/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AdminStore } from '@byline/admin'
import { hashPassword, JwtSessionProvider } from '@byline/admin/auth'
import { AdminAuth, AuthError, AuthErrorCodes } from '@byline/auth'
import { eq, inArray } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { adminUsers } from '../../../database/schema/auth.js'
import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'
import { createAdminStore } from '../admin-store.js'
import type * as schema from '../../../database/schema/index.js'

// ---------------------------------------------------------------------------
// Track-and-clean fixtures
// ---------------------------------------------------------------------------
//
// Integration tests share the dev database. Instead of a blanket wipe
// (which would destroy the developer's signed-in super-admin), we track
// each admin-user row a test creates and delete only those ids on
// teardown. `adminRefreshTokens` cascades from `adminUsers`, so the
// token rows are cleaned up automatically. No roles are created in this
// suite — it only exercises the session provider.

let db: NodePgDatabase<typeof schema>
let store: AdminStore

const trackedUserIds = new Set<string>()

// Pure-JS argon2id takes ~1 s per hash; most tests here use the same
// 'pw' password for both the create and the subsequent sign-in. Hash it
// once and reuse — saves ~10–15 s on every run. Tests that need a
// different password (alice's 'pw-alice', bob's 'correct') pay the
// per-hash cost on demand.
const SHARED_PASSWORD = 'pw'
let SHARED_HASH = ''

const SIGNING_SECRET = 'test-signing-secret-at-least-32-bytes-long-here'

function makeProvider(options?: {
  accessTokenTtlSeconds?: number
  refreshTokenTtlSeconds?: number
  now?: () => Date
}) {
  return new JwtSessionProvider({
    store,
    signingSecret: SIGNING_SECRET,
    accessTokenTtlSeconds: options?.accessTokenTtlSeconds,
    refreshTokenTtlSeconds: options?.refreshTokenTtlSeconds,
    now: options?.now,
  })
}

async function hashFor(password: string): Promise<string> {
  return password === SHARED_PASSWORD ? SHARED_HASH : await hashPassword(password)
}

async function createEnabledUser(email: string, password: string) {
  // Clear any stale row left by a crashed prior run.
  await db.delete(adminUsers).where(eq(adminUsers.email, email.toLowerCase()))
  const row = await store.adminUsers.create({
    email,
    password_hash: await hashFor(password),
    is_enabled: true,
  })
  trackedUserIds.add(row.id)
  return row
}

async function createDisabledUser(email: string, password: string) {
  await db.delete(adminUsers).where(eq(adminUsers.email, email.toLowerCase()))
  const row = await store.adminUsers.create({
    email,
    password_hash: await hashFor(password),
    is_enabled: false,
  })
  trackedUserIds.add(row.id)
  return row
}

async function cleanupTrackedRows() {
  if (trackedUserIds.size > 0) {
    await db.delete(adminUsers).where(inArray(adminUsers.id, [...trackedUserIds]))
  }
  trackedUserIds.clear()
}

// ---------------------------------------------------------------------------

describe('JwtSessionProvider', () => {
  beforeAll(async () => {
    const testDB = setupTestDB([])
    db = testDB.db
    store = createAdminStore(db)
    SHARED_HASH = await hashPassword(SHARED_PASSWORD)
  })

  afterEach(async () => {
    await cleanupTrackedRows()
  })

  afterAll(async () => {
    await cleanupTrackedRows()
    await teardownTestDB()
  })

  describe('construction', () => {
    it('rejects a short signing secret', () => {
      expect(() => new JwtSessionProvider({ store, signingSecret: 'too-short' })).toThrow(
        /at least 32 bytes/
      )
    })

    it('declares capabilities', () => {
      const provider = makeProvider()
      expect(provider.capabilities).toEqual({
        passwordChange: true,
        magicLink: false,
        sso: false,
      })
    })
  })

  describe('signInWithPassword', () => {
    it('succeeds with correct credentials and enabled account', async () => {
      await createEnabledUser('alice@example.com', 'pw-alice')
      const provider = makeProvider()
      const result = await provider.signInWithPassword({
        email: 'alice@example.com',
        password: 'pw-alice',
        ip: '10.0.0.1',
        userAgent: 'test',
      })
      expect(result.accessToken).toBeTruthy()
      expect(result.refreshToken).toBeTruthy()
      expect(result.actor instanceof AdminAuth).toBeTruthy()
      expect(result.actor.isSuperAdmin).toBe(false)
      expect(result.accessTokenExpiresAt.getTime() > Date.now()).toBeTruthy()
      expect(result.refreshTokenExpiresAt.getTime() > Date.now()).toBeTruthy()
    })

    it('throws ERR_INVALID_CREDENTIALS on unknown email', async () => {
      const provider = makeProvider()
      try {
        await provider.signInWithPassword({
          email: 'nobody@example.com',
          password: 'whatever',
        })
        throw new Error('expected ERR_INVALID_CREDENTIALS')
      } catch (err) {
        expect(err instanceof AuthError).toBeTruthy()
        expect((err as AuthError).code).toBe(AuthErrorCodes.INVALID_CREDENTIALS)
      }
      // Note: signInWithPassword runs a timing-equaliser argon2 verify on
      // the unknown-email path so the wrong-email and wrong-password
      // codepaths take comparable time. We don't assert on timing here —
      // it's too machine-dependent to be a stable test — but behaviour is.
    })

    it('throws ERR_INVALID_CREDENTIALS on wrong password and increments failed_login_attempts', async () => {
      const user = await createEnabledUser('bob@example.com', 'correct')
      const provider = makeProvider()
      try {
        await provider.signInWithPassword({ email: 'bob@example.com', password: 'wrong' })
        throw new Error('expected ERR_INVALID_CREDENTIALS')
      } catch (err) {
        expect((err as AuthError).code).toBe(AuthErrorCodes.INVALID_CREDENTIALS)
      }
      const row = await store.adminUsers.getById(user.id)
      expect(row?.failed_login_attempts).toBe(1)
    })

    it('throws ERR_ACCOUNT_DISABLED for a correct-password but disabled account', async () => {
      await createDisabledUser('disabled@example.com', 'pw')
      const provider = makeProvider()
      try {
        await provider.signInWithPassword({ email: 'disabled@example.com', password: 'pw' })
        throw new Error('expected ERR_ACCOUNT_DISABLED')
      } catch (err) {
        expect((err as AuthError).code).toBe(AuthErrorCodes.ACCOUNT_DISABLED)
      }
    })

    it('persists a refresh-token row with the recorded ip and user agent', async () => {
      const user = await createEnabledUser('c@example.com', 'pw')
      const provider = makeProvider()
      await provider.signInWithPassword({
        email: 'c@example.com',
        password: 'pw',
        ip: '192.168.1.5',
        userAgent: 'Mozilla/test',
      })
      const rows = await store.refreshTokens.listAllForUser(user.id)
      expect(rows.length).toBe(1)
      expect(rows[0]?.ip).toBe('192.168.1.5')
      expect(rows[0]?.user_agent).toBe('Mozilla/test')
      expect(rows[0]?.revoked_at).toBe(null)
    })
  })

  describe('verifyAccessToken', () => {
    it('verifies a freshly-issued access token and returns the actor', async () => {
      const user = await createEnabledUser('d@example.com', 'pw')
      const provider = makeProvider()
      const { accessToken } = await provider.signInWithPassword({
        email: 'd@example.com',
        password: 'pw',
      })
      const { actor } = await provider.verifyAccessToken(accessToken)
      expect(actor.id).toBe(user.id)
    })

    it('throws ERR_INVALID_TOKEN for gibberish', async () => {
      const provider = makeProvider()
      try {
        await provider.verifyAccessToken('not-a-jwt')
        throw new Error('expected ERR_INVALID_TOKEN')
      } catch (err) {
        expect((err as AuthError).code).toBe(AuthErrorCodes.INVALID_TOKEN)
      }
    })

    it('throws ERR_INVALID_TOKEN for an expired token', async () => {
      await createEnabledUser('e@example.com', 'pw')
      // Mint with a long-past `now`, making the token already expired.
      const pastClock = () => new Date(Date.now() - 60 * 60 * 1000)
      const pastProvider = makeProvider({ now: pastClock, accessTokenTtlSeconds: 60 })
      const { accessToken } = await pastProvider.signInWithPassword({
        email: 'e@example.com',
        password: 'pw',
      })
      const freshProvider = makeProvider()
      try {
        await freshProvider.verifyAccessToken(accessToken)
        throw new Error('expected ERR_INVALID_TOKEN')
      } catch (err) {
        expect((err as AuthError).code).toBe(AuthErrorCodes.INVALID_TOKEN)
      }
    })

    it('throws ERR_ACCOUNT_DISABLED when the subject has been disabled since issuance', async () => {
      const user = await createEnabledUser('f@example.com', 'pw')
      const provider = makeProvider()
      const { accessToken } = await provider.signInWithPassword({
        email: 'f@example.com',
        password: 'pw',
      })
      await store.adminUsers.setEnabled(user.id, false)
      try {
        await provider.verifyAccessToken(accessToken)
        throw new Error('expected ERR_ACCOUNT_DISABLED')
      } catch (err) {
        expect((err as AuthError).code).toBe(AuthErrorCodes.ACCOUNT_DISABLED)
      }
    })

    it('throws ERR_INVALID_TOKEN when the signature is tampered', async () => {
      await createEnabledUser('g@example.com', 'pw')
      const provider = makeProvider()
      const { accessToken } = await provider.signInWithPassword({
        email: 'g@example.com',
        password: 'pw',
      })
      const parts = accessToken.split('.')
      // Flip a char in the middle of the signature, not at either end.
      // HS256 sigs are 32 bytes → 43 base64url chars → 258 bits of capacity,
      // so the *last* char carries 2 padding zero bits. A naive last-char
      // flip can land on a different encoded char whose top 4 bits map to
      // the same signature byte (e.g. `Y` ↔ `a` both decode to top-4=`0110`),
      // leaving the signature unchanged and the test flaky. Middle chars
      // span byte boundaries cleanly, so any flip guarantees a byte change.
      const sig = parts[2] ?? ''
      const mid = Math.floor(sig.length / 2)
      const flipped = `${sig.slice(0, mid)}${sig[mid] === 'a' ? 'b' : 'a'}${sig.slice(mid + 1)}`
      parts[2] = flipped
      const tampered = parts.join('.')
      try {
        await provider.verifyAccessToken(tampered)
        throw new Error('expected ERR_INVALID_TOKEN')
      } catch (err) {
        expect((err as AuthError).code).toBe(AuthErrorCodes.INVALID_TOKEN)
      }
    })
  })

  describe('refreshSession', () => {
    it('rotates the refresh token and issues a fresh access token', async () => {
      const user = await createEnabledUser('h@example.com', 'pw')
      const provider = makeProvider()
      const signIn = await provider.signInWithPassword({
        email: 'h@example.com',
        password: 'pw',
      })

      const refreshed = await provider.refreshSession({ refreshToken: signIn.refreshToken })

      expect(refreshed.refreshToken).not.toBe(signIn.refreshToken)
      expect(refreshed.accessToken).not.toBe(signIn.accessToken)

      // Old token is now revoked and points at the new one
      const rows = await store.refreshTokens.listAllForUser(user.id)
      expect(rows.length).toBe(2)
      const [oldRow, newRow] = rows
      expect(oldRow?.revoked_at).toBeTruthy()
      expect(oldRow?.rotated_to_id).toBe(newRow?.id)
      expect(newRow?.revoked_at).toBe(null)

      // The new token verifies
      const { actor } = await provider.verifyAccessToken(refreshed.accessToken)
      expect(actor.id).toBe(user.id)
    })

    it('throws ERR_INVALID_TOKEN for an unknown refresh token', async () => {
      const provider = makeProvider()
      try {
        await provider.refreshSession({ refreshToken: 'totally-bogus' })
        throw new Error('expected ERR_INVALID_TOKEN')
      } catch (err) {
        expect((err as AuthError).code).toBe(AuthErrorCodes.INVALID_TOKEN)
      }
    })

    it('throws ERR_INVALID_TOKEN for an expired refresh token', async () => {
      await createEnabledUser('i@example.com', 'pw')
      const pastClock = () => new Date(Date.now() - 24 * 60 * 60 * 1000)
      const pastProvider = makeProvider({ now: pastClock, refreshTokenTtlSeconds: 60 })
      const { refreshToken } = await pastProvider.signInWithPassword({
        email: 'i@example.com',
        password: 'pw',
      })
      const freshProvider = makeProvider()
      try {
        await freshProvider.refreshSession({ refreshToken })
        throw new Error('expected ERR_INVALID_TOKEN')
      } catch (err) {
        expect((err as AuthError).code).toBe(AuthErrorCodes.INVALID_TOKEN)
      }
    })

    it('throws ERR_REVOKED_TOKEN when replaying a rotated token — and revokes the chain', async () => {
      const user = await createEnabledUser('j@example.com', 'pw')
      const provider = makeProvider()
      const signIn = await provider.signInWithPassword({
        email: 'j@example.com',
        password: 'pw',
      })
      // Legitimate rotation: sign-in → refresh-1 → refresh-2
      const r1 = await provider.refreshSession({ refreshToken: signIn.refreshToken })
      const r2 = await provider.refreshSession({ refreshToken: r1.refreshToken })
      expect(r2.refreshToken).toBeTruthy()

      // An attacker replays the original (already-rotated) refreshToken.
      try {
        await provider.refreshSession({ refreshToken: signIn.refreshToken })
        throw new Error('expected ERR_REVOKED_TOKEN')
      } catch (err) {
        expect((err as AuthError).code).toBe(AuthErrorCodes.REVOKED_TOKEN)
      }

      // The entire chain descended from the replayed token is now revoked.
      const rows = await store.refreshTokens.listAllForUser(user.id)
      for (const row of rows) {
        expect(row.revoked_at, `row ${row.id} expected revoked, got null`).toBeTruthy()
      }
    })

    it('throws ERR_REVOKED_TOKEN for an explicitly revoked token', async () => {
      await createEnabledUser('k@example.com', 'pw')
      const provider = makeProvider()
      const signIn = await provider.signInWithPassword({
        email: 'k@example.com',
        password: 'pw',
      })
      await provider.revokeSession(signIn.refreshToken)
      try {
        await provider.refreshSession({ refreshToken: signIn.refreshToken })
        throw new Error('expected ERR_REVOKED_TOKEN')
      } catch (err) {
        expect((err as AuthError).code).toBe(AuthErrorCodes.REVOKED_TOKEN)
      }
    })
  })

  describe('revokeSession', () => {
    it('marks the row revoked and is idempotent', async () => {
      const user = await createEnabledUser('l@example.com', 'pw')
      const provider = makeProvider()
      const signIn = await provider.signInWithPassword({
        email: 'l@example.com',
        password: 'pw',
      })
      await provider.revokeSession(signIn.refreshToken)
      await provider.revokeSession(signIn.refreshToken) // idempotent

      const rows = await store.refreshTokens.listAllForUser(user.id)
      expect(rows.length).toBe(1)
      expect(rows[0]?.revoked_at).toBeTruthy()
    })

    it('is a no-op for unknown tokens', async () => {
      const provider = makeProvider()
      await provider.revokeSession('no-such-token') // does not throw
    })
  })

  describe('resolveActor', () => {
    it('delegates to the underlying admin identity graph', async () => {
      const user = await createEnabledUser('m@example.com', 'pw')
      const provider = makeProvider()
      const actor = await provider.resolveActor(user.id)
      expect(actor instanceof AdminAuth).toBeTruthy()
      expect(actor?.id).toBe(user.id)
    })

    it('returns null for a disabled user', async () => {
      const user = await createDisabledUser('n@example.com', 'pw')
      const provider = makeProvider()
      expect(await provider.resolveActor(user.id)).toBe(null)
    })
  })
})
