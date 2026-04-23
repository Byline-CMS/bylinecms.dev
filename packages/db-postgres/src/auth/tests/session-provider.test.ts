/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import assert from 'node:assert'
import { after, before, beforeEach, describe, it } from 'node:test'

import { AdminAuth, AuthError, AuthErrorCodes } from '@byline/auth'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import {
  adminPermissions,
  adminRefreshTokens,
  adminRoleAdminUser,
  adminRoles,
  adminUsers,
} from '../../database/schema/auth.js'
import { setupTestDB, teardownTestDB } from '../../lib/test-helper.js'
import { createAdminUsersRepository } from '../admin-users-repository.js'
import { JwtSessionProvider } from '../jwt-session-provider.js'
import { createRefreshTokensRepository } from '../refresh-tokens-repository.js'
import type * as schema from '../../database/schema/index.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let db: NodePgDatabase<typeof schema>

const SIGNING_SECRET = 'test-signing-secret-at-least-32-bytes-long-here'

function makeProvider(options?: {
  accessTokenTtlSeconds?: number
  refreshTokenTtlSeconds?: number
  now?: () => Date
}) {
  return new JwtSessionProvider({
    db,
    signingSecret: SIGNING_SECRET,
    accessTokenTtlSeconds: options?.accessTokenTtlSeconds,
    refreshTokenTtlSeconds: options?.refreshTokenTtlSeconds,
    now: options?.now,
  })
}

async function cleanAuthTables() {
  await db.delete(adminRefreshTokens)
  await db.delete(adminPermissions)
  await db.delete(adminRoleAdminUser)
  await db.delete(adminRoles)
  await db.delete(adminUsers)
}

async function createEnabledUser(email: string, password: string) {
  const users = createAdminUsersRepository(db)
  return users.create({ email, password, is_enabled: true })
}

// ---------------------------------------------------------------------------

describe('JwtSessionProvider', () => {
  before(() => {
    const testDB = setupTestDB([])
    db = testDB.db
  })

  beforeEach(async () => {
    await cleanAuthTables()
  })

  after(async () => {
    await cleanAuthTables()
    await teardownTestDB()
  })

  describe('construction', () => {
    it('rejects a short signing secret', () => {
      assert.throws(
        () => new JwtSessionProvider({ db, signingSecret: 'too-short' }),
        /at least 32 bytes/
      )
    })

    it('declares capabilities', () => {
      const provider = makeProvider()
      assert.deepStrictEqual(provider.capabilities, {
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
      assert.ok(result.accessToken)
      assert.ok(result.refreshToken)
      assert.ok(result.actor instanceof AdminAuth)
      assert.strictEqual(result.actor.isSuperAdmin, false)
      assert.ok(result.accessTokenExpiresAt.getTime() > Date.now())
      assert.ok(result.refreshTokenExpiresAt.getTime() > Date.now())
    })

    it('throws ERR_INVALID_CREDENTIALS on unknown email', async () => {
      const provider = makeProvider()
      try {
        await provider.signInWithPassword({
          email: 'nobody@example.com',
          password: 'whatever',
        })
        assert.fail('expected ERR_INVALID_CREDENTIALS')
      } catch (err) {
        assert.ok(err instanceof AuthError)
        assert.strictEqual((err as AuthError).code, AuthErrorCodes.INVALID_CREDENTIALS)
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
        assert.fail('expected ERR_INVALID_CREDENTIALS')
      } catch (err) {
        assert.strictEqual((err as AuthError).code, AuthErrorCodes.INVALID_CREDENTIALS)
      }
      const users = createAdminUsersRepository(db)
      const row = await users.getById(user.id)
      assert.strictEqual(row?.failed_login_attempts, 1)
    })

    it('throws ERR_ACCOUNT_DISABLED for a correct-password but disabled account', async () => {
      const users = createAdminUsersRepository(db)
      await users.create({
        email: 'disabled@example.com',
        password: 'pw',
        is_enabled: false,
      })
      const provider = makeProvider()
      try {
        await provider.signInWithPassword({ email: 'disabled@example.com', password: 'pw' })
        assert.fail('expected ERR_ACCOUNT_DISABLED')
      } catch (err) {
        assert.strictEqual((err as AuthError).code, AuthErrorCodes.ACCOUNT_DISABLED)
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
      const refreshTokens = createRefreshTokensRepository(db)
      const rows = await refreshTokens.listAllForUser(user.id)
      assert.strictEqual(rows.length, 1)
      assert.strictEqual(rows[0]?.ip, '192.168.1.5')
      assert.strictEqual(rows[0]?.user_agent, 'Mozilla/test')
      assert.strictEqual(rows[0]?.revoked_at, null)
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
      assert.strictEqual(actor.id, user.id)
    })

    it('throws ERR_INVALID_TOKEN for gibberish', async () => {
      const provider = makeProvider()
      try {
        await provider.verifyAccessToken('not-a-jwt')
        assert.fail('expected ERR_INVALID_TOKEN')
      } catch (err) {
        assert.strictEqual((err as AuthError).code, AuthErrorCodes.INVALID_TOKEN)
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
        assert.fail('expected ERR_INVALID_TOKEN')
      } catch (err) {
        assert.strictEqual((err as AuthError).code, AuthErrorCodes.INVALID_TOKEN)
      }
    })

    it('throws ERR_ACCOUNT_DISABLED when the subject has been disabled since issuance', async () => {
      const user = await createEnabledUser('f@example.com', 'pw')
      const provider = makeProvider()
      const { accessToken } = await provider.signInWithPassword({
        email: 'f@example.com',
        password: 'pw',
      })
      const users = createAdminUsersRepository(db)
      await users.setEnabled(user.id, false)
      try {
        await provider.verifyAccessToken(accessToken)
        assert.fail('expected ERR_ACCOUNT_DISABLED')
      } catch (err) {
        assert.strictEqual((err as AuthError).code, AuthErrorCodes.ACCOUNT_DISABLED)
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
      // Flip the last char of the signature
      const last = parts[2] ?? ''
      const flipped = `${last.slice(0, -1)}${last.at(-1) === 'a' ? 'b' : 'a'}`
      parts[2] = flipped
      const tampered = parts.join('.')
      try {
        await provider.verifyAccessToken(tampered)
        assert.fail('expected ERR_INVALID_TOKEN')
      } catch (err) {
        assert.strictEqual((err as AuthError).code, AuthErrorCodes.INVALID_TOKEN)
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

      assert.notStrictEqual(refreshed.refreshToken, signIn.refreshToken)
      assert.notStrictEqual(refreshed.accessToken, signIn.accessToken)

      // Old token is now revoked and points at the new one
      const refreshTokens = createRefreshTokensRepository(db)
      const rows = await refreshTokens.listAllForUser(user.id)
      assert.strictEqual(rows.length, 2)
      const [oldRow, newRow] = rows
      assert.ok(oldRow?.revoked_at)
      assert.strictEqual(oldRow?.rotated_to_id, newRow?.id)
      assert.strictEqual(newRow?.revoked_at, null)

      // The new token verifies
      const { actor } = await provider.verifyAccessToken(refreshed.accessToken)
      assert.strictEqual(actor.id, user.id)
    })

    it('throws ERR_INVALID_TOKEN for an unknown refresh token', async () => {
      const provider = makeProvider()
      try {
        await provider.refreshSession({ refreshToken: 'totally-bogus' })
        assert.fail('expected ERR_INVALID_TOKEN')
      } catch (err) {
        assert.strictEqual((err as AuthError).code, AuthErrorCodes.INVALID_TOKEN)
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
        assert.fail('expected ERR_INVALID_TOKEN')
      } catch (err) {
        assert.strictEqual((err as AuthError).code, AuthErrorCodes.INVALID_TOKEN)
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
      assert.ok(r2.refreshToken)

      // An attacker replays the original (already-rotated) refreshToken.
      try {
        await provider.refreshSession({ refreshToken: signIn.refreshToken })
        assert.fail('expected ERR_REVOKED_TOKEN')
      } catch (err) {
        assert.strictEqual((err as AuthError).code, AuthErrorCodes.REVOKED_TOKEN)
      }

      // The entire chain descended from the replayed token is now revoked.
      const refreshTokens = createRefreshTokensRepository(db)
      const rows = await refreshTokens.listAllForUser(user.id)
      for (const row of rows) {
        assert.ok(row.revoked_at, `row ${row.id} expected revoked, got null`)
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
        assert.fail('expected ERR_REVOKED_TOKEN')
      } catch (err) {
        assert.strictEqual((err as AuthError).code, AuthErrorCodes.REVOKED_TOKEN)
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

      const refreshTokens = createRefreshTokensRepository(db)
      const rows = await refreshTokens.listAllForUser(user.id)
      assert.strictEqual(rows.length, 1)
      assert.ok(rows[0]?.revoked_at)
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
      assert.ok(actor instanceof AdminAuth)
      assert.strictEqual(actor.id, user.id)
    })

    it('returns null for a disabled user', async () => {
      const users = createAdminUsersRepository(db)
      const user = await users.create({
        email: 'n@example.com',
        password: 'pw',
        is_enabled: false,
      })
      const provider = makeProvider()
      assert.strictEqual(await provider.resolveActor(user.id), null)
    })
  })
})
