/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AdminStore } from '@byline/admin'
import { seedSuperAdmin } from '@byline/admin/admin-users'
import { hashPassword, JwtSessionProvider, resolveActor, verifyPassword } from '@byline/admin/auth'
import { AdminAuth, AuthError, AuthErrorCodes } from '@byline/auth'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import type { ConformanceHooks } from '../index.js'

const SIGNING_SECRET = 'test-signing-secret-at-least-32-bytes-long-here'

/** The resolved, non-optional form of `hooks.createAdminStore` — every
 * suite below receives this already-narrowed function rather than the
 * optional `hooks.createAdminStore` directly, so no `!` assertions are
 * needed at the call sites. */
type CreateAdminStore = () => Promise<AdminStore>

/**
 * Ported from `packages/db-postgres/src/modules/admin/tests/admin-preferences.test.ts`.
 * Exercises `AdminPreferencesRepository` (the `adminPreferences` slice of
 * `AdminStore`) through the repository interface only. The original used a
 * raw drizzle insert to create its fixture user and a raw drizzle select
 * against `adminUserPreferences` to prove cascade-delete; both are replaced
 * here with the equivalent `AdminStore` calls (`adminUsers.create` /
 * `adminPreferences.get` returning `null`) — same facts, proven through the
 * public contract instead of adapter-internal schema access.
 */
function adminPreferencesSuite(hooks: ConformanceHooks, createAdminStore: CreateAdminStore): void {
  const SCOPE = 'collections.docs.list'

  describe('admin-preferences repository (integration)', () => {
    let store: AdminStore
    const createdUsers: Array<{ id: string; vid: number }> = []

    async function createUser(): Promise<string> {
      const row = await store.adminUsers.create({
        email: `pref-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
        password_hash: '$argon2id$test-not-a-real-hash',
        is_enabled: true,
      })
      createdUsers.push({ id: row.id, vid: row.vid })
      return row.id
    }

    beforeAll(async () => {
      await hooks.truncate()
      store = await createAdminStore()
    })

    afterEach(async () => {
      while (createdUsers.length > 0) {
        const user = createdUsers.pop()!
        const current = await store.adminUsers.getById(user.id)
        if (current) await store.adminUsers.delete(user.id, current.vid)
      }
    })

    it('returns null for a missing (user, scope) row', async () => {
      const userId = await createUser()
      expect(await store.adminPreferences.get(userId, SCOPE)).toBeNull()
    })

    it('inserts on first upsert and reads the value back', async () => {
      const userId = await createUser()
      const row = await store.adminPreferences.upsert(userId, SCOPE, { page_size: 50 })
      expect(row.user_id).toBe(userId)
      expect(row.scope).toBe(SCOPE)
      expect(row.value).toEqual({ page_size: 50 })

      const read = await store.adminPreferences.get(userId, SCOPE)
      expect(read?.value).toEqual({ page_size: 50 })
    })

    it('merges per key on conflict — page_size write preserves a stored sort', async () => {
      const userId = await createUser()
      await store.adminPreferences.upsert(userId, SCOPE, { order: 'title', desc: true })
      const merged = await store.adminPreferences.upsert(userId, SCOPE, { page_size: 30 })
      expect(merged.value).toEqual({ order: 'title', desc: true, page_size: 30 })
    })

    it('overwrites the same key on conflict (last writer wins per key)', async () => {
      const userId = await createUser()
      await store.adminPreferences.upsert(userId, SCOPE, { page_size: 15 })
      const updated = await store.adminPreferences.upsert(userId, SCOPE, { page_size: 100 })
      expect(updated.value).toEqual({ page_size: 100 })
    })

    it('keeps scopes independent for the same user', async () => {
      const userId = await createUser()
      await store.adminPreferences.upsert(userId, SCOPE, { page_size: 50 })
      await store.adminPreferences.upsert(userId, 'collections.media.list', { page_size: 15 })
      expect((await store.adminPreferences.get(userId, SCOPE))?.value).toEqual({ page_size: 50 })
      expect((await store.adminPreferences.get(userId, 'collections.media.list'))?.value).toEqual({
        page_size: 15,
      })
    })

    it('cascade-deletes preference rows with the user', async () => {
      const userId = await createUser()
      await store.adminPreferences.upsert(userId, SCOPE, { page_size: 50 })
      const user = createdUsers.pop()! // this test deletes the user itself
      await store.adminUsers.delete(userId, user.vid)
      const orphan = await store.adminPreferences.get(userId, SCOPE)
      expect(orphan).toBeNull()
    })
  })
}

/**
 * Ported from `packages/db-postgres/src/modules/admin/tests/session-provider.test.ts`.
 * Exercises the built-in `JwtSessionProvider` against an `AdminStore` —
 * every assertion is unchanged; only fixture plumbing (store construction,
 * the crash-safety pre-clean-by-email helper) moved from raw drizzle to
 * `AdminStore` repository calls.
 */
function sessionProviderSuite(hooks: ConformanceHooks, createAdminStore: CreateAdminStore): void {
  describe('JwtSessionProvider', () => {
    let store: AdminStore
    const trackedUserIds = new Set<string>()

    // Pure-JS argon2id takes ~1 s per hash; most tests here use the same
    // 'pw' password for both the create and the subsequent sign-in. Hash it
    // once and reuse — saves ~10-15 s on every run. Tests that need a
    // different password (alice's 'pw-alice', bob's 'correct') pay the
    // per-hash cost on demand.
    const SHARED_PASSWORD = 'pw'
    let SHARED_HASH = ''

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

    async function preCleanEmail(email: string): Promise<void> {
      // Clear any stale row left by a crashed prior run.
      const existing = await store.adminUsers.getByEmail(email.toLowerCase())
      if (existing) await store.adminUsers.delete(existing.id, existing.vid)
    }

    async function createEnabledUser(email: string, password: string) {
      await preCleanEmail(email)
      const row = await store.adminUsers.create({
        email,
        password_hash: await hashFor(password),
        is_enabled: true,
      })
      trackedUserIds.add(row.id)
      return row
    }

    async function createDisabledUser(email: string, password: string) {
      await preCleanEmail(email)
      const row = await store.adminUsers.create({
        email,
        password_hash: await hashFor(password),
        is_enabled: false,
      })
      trackedUserIds.add(row.id)
      return row
    }

    async function cleanupTrackedRows() {
      for (const id of trackedUserIds) {
        const current = await store.adminUsers.getById(id)
        if (current) await store.adminUsers.delete(id, current.vid)
      }
      trackedUserIds.clear()
    }

    beforeAll(async () => {
      await hooks.truncate()
      store = await createAdminStore()
      SHARED_HASH = await hashPassword(SHARED_PASSWORD)
    })

    afterEach(async () => {
      await cleanupTrackedRows()
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
        // the same signature byte (e.g. `Y` <-> `a` both decode to top-4=`0110`),
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
        // Legitimate rotation: sign-in -> refresh-1 -> refresh-2
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
}

/**
 * Ported from `packages/db-postgres/src/modules/admin/tests/auth-integration.test.ts`.
 * Exercises `AdminUsersRepository`, `AdminRolesRepository`,
 * `AdminPermissionsRepository`, `resolveActor`, and `seedSuperAdmin` — all
 * through the `AdminStore` bundle. The original's cascade-delete assertions
 * queried `adminPermissions` / `adminRoleAdminUser` directly via raw
 * drizzle; those are replaced with the equivalent repository reads
 * (`adminPermissions.listAbilities` / `adminRoles.listUsersForRole`, both
 * returning `[]` once the cascade has run) — same fact, proven through the
 * public contract.
 */
function authIntegrationSuite(hooks: ConformanceHooks, createAdminStore: CreateAdminStore): void {
  describe('auth integration', () => {
    let store: AdminStore
    const trackedUserIds = new Set<string>()
    const trackedRoleIds = new Set<string>()

    // Pure-JS argon2id takes ~1 s per hash; this suite makes ~20 users, only
    // one of which is later verified against its plaintext (the
    // getByEmailForSignIn test). Pre-compute one hash for the common-case
    // password ('pw') and reuse it for every test that doesn't care about
    // the actual hash value — saves ~20 s on every run.
    const SHARED_PASSWORD = 'pw'
    let SHARED_HASH = ''

    function trackUser(id: string) {
      trackedUserIds.add(id)
    }
    function trackRole(id: string) {
      trackedRoleIds.add(id)
    }

    async function createUser(input: {
      email: string
      password: string
      given_name?: string | null
      is_enabled?: boolean
      is_super_admin?: boolean
    }) {
      const email = input.email.toLowerCase()
      // Clear any stale row left by a crashed prior run.
      const existing = await store.adminUsers.getByEmail(email)
      if (existing) await store.adminUsers.delete(existing.id, existing.vid)
      // Reuse the pre-computed hash when the password is the shared marker;
      // tests that actually verify the plaintext (verifyPassword,
      // signInWithPassword) supply their own password and pay the real hash
      // cost.
      const password_hash =
        input.password === SHARED_PASSWORD ? SHARED_HASH : await hashPassword(input.password)
      const row = await store.adminUsers.create({
        email: input.email,
        password_hash,
        given_name: input.given_name,
        is_enabled: input.is_enabled,
        is_super_admin: input.is_super_admin,
      })
      trackUser(row.id)
      return row
    }

    async function createRole(input: {
      name: string
      machine_name: string
      description?: string | null
      order?: number
    }) {
      const existing = await store.adminRoles.getByMachineName(input.machine_name)
      if (existing) await store.adminRoles.delete(existing.id, existing.vid)
      const row = await store.adminRoles.create(input)
      trackRole(row.id)
      return row
    }

    async function cleanupTrackedRows() {
      for (const id of trackedUserIds) {
        const current = await store.adminUsers.getById(id)
        if (current) await store.adminUsers.delete(id, current.vid)
      }
      for (const id of trackedRoleIds) {
        const current = await store.adminRoles.getById(id)
        if (current) await store.adminRoles.delete(id, current.vid)
      }
      trackedUserIds.clear()
      trackedRoleIds.clear()
    }

    beforeAll(async () => {
      await hooks.truncate()
      store = await createAdminStore()
      SHARED_HASH = await hashPassword(SHARED_PASSWORD)
    })

    afterEach(async () => {
      await cleanupTrackedRows()
    })

    // -------------------------------------------------------------------------
    // Admin users
    // -------------------------------------------------------------------------

    describe('admin users repository', () => {
      it('creates, reads, and hides the password hash from public rows', async () => {
        const created = await createUser({
          email: 'alice@example.com',
          password: 'alice-password',
          given_name: 'Alice',
        })
        expect(created.id).toBeTruthy()
        expect(created.email).toBe('alice@example.com')
        expect(created.given_name).toBe('Alice')
        expect(created.is_enabled).toBe(false) // default false
        expect(created.is_super_admin).toBe(false)
        // Public columns: password_hash is never returned
        expect((created as any).password_hash).toBe(undefined)

        const fetched = await store.adminUsers.getById(created.id)
        expect(fetched?.email).toBe('alice@example.com')
      })

      it('lowercases the email on insert and on lookup', async () => {
        await createUser({ email: 'Alice@Example.COM', password: 'pw' })
        const byMixed = await store.adminUsers.getByEmail('ALICE@example.com')
        expect(byMixed).toBeTruthy()
        expect(byMixed?.email).toBe('alice@example.com')
      })

      it('returns the password hash only via getByEmailForSignIn', async () => {
        await createUser({ email: 'b@example.com', password: 'pw-value' })

        const plain = await store.adminUsers.getByEmail('b@example.com')
        expect((plain as any)?.password_hash).toBe(undefined)

        const withPw = await store.adminUsers.getByEmailForSignIn('b@example.com')
        // `if !x throw` instead of `x!` so Biome's --unsafe rewrite (which
        // turns `!` into `?.`) doesn't reintroduce `string | undefined`
        // through verifyPassword's `hash: string` arg.
        if (!withPw) throw new Error('expected withPw to be defined')
        expect(await verifyPassword('pw-value', withPw.password_hash)).toBeTruthy()
      })

      it('update applies partial patches and bumps vid', async () => {
        const created = await createUser({ email: 'c@example.com', password: 'pw' })
        expect(created.vid).toBe(1)
        const updated = await store.adminUsers.update(created.id, created.vid, {
          given_name: 'Charlie',
          is_enabled: true,
        })
        expect(updated.given_name).toBe('Charlie')
        expect(updated.is_enabled).toBe(true)
        // Unchanged fields remain
        expect(updated.email).toBe('c@example.com')
        expect(updated.vid).toBe(created.vid + 1)
      })

      it('update throws VERSION_CONFLICT on a stale vid', async () => {
        const created = await createUser({ email: 'c2@example.com', password: 'pw' })
        // First update succeeds and bumps vid.
        await store.adminUsers.update(created.id, created.vid, { given_name: 'First' })
        // Replaying the same vid must conflict.
        await expect(() =>
          store.adminUsers.update(created.id, created.vid, { given_name: 'Second' })
        ).rejects.toMatchObject({ code: 'admin.users.versionConflict' })
      })

      it('setPasswordHash rehashes, bumps vid, and returns the fresh row', async () => {
        const created = await createUser({ email: 'd@example.com', password: 'old' })
        const updated = await store.adminUsers.setPasswordHash(
          created.id,
          created.vid,
          await hashPassword('new-password')
        )
        expect(updated.id).toBe(created.id)
        expect(updated.vid).toBe(created.vid + 1)

        const signIn = await store.adminUsers.getByEmailForSignIn('d@example.com')
        if (!signIn) throw new Error('expected signIn to be defined')
        expect(await verifyPassword('new-password', signIn.password_hash)).toBeTruthy()
        expect(await verifyPassword('old', signIn.password_hash)).toBe(false)
        expect(signIn.vid).toBe(created.vid + 1)
      })

      it('setPasswordHash throws VERSION_CONFLICT on a stale vid', async () => {
        const created = await createUser({ email: 'd2@example.com', password: 'pw' })
        await store.adminUsers.update(created.id, created.vid, { given_name: 'D' })
        await expect(() =>
          store.adminUsers.setPasswordHash(created.id, created.vid, '$argon2id$stale-hash')
        ).rejects.toMatchObject({ code: 'admin.users.versionConflict' })
      })

      it('recordLoginSuccess resets failed_login_attempts and stamps last_login', async () => {
        const created = await createUser({ email: 'e@example.com', password: 'pw' })
        await store.adminUsers.recordLoginFailure(created.id)
        await store.adminUsers.recordLoginFailure(created.id)
        let row = await store.adminUsers.getById(created.id)
        expect(row?.failed_login_attempts).toBe(2)

        await store.adminUsers.recordLoginSuccess(created.id, '10.0.0.1')
        row = await store.adminUsers.getById(created.id)
        expect(row?.failed_login_attempts).toBe(0)
        expect(row?.last_login_ip).toBe('10.0.0.1')
        expect(row?.last_login).toBeTruthy()
      })

      it('delete removes the row when vid matches', async () => {
        const created = await createUser({ email: 'f@example.com', password: 'pw' })
        await store.adminUsers.delete(created.id, created.vid)
        trackedUserIds.delete(created.id)
        const fetched = await store.adminUsers.getById(created.id)
        expect(fetched).toBe(null)
      })

      it('delete throws VERSION_CONFLICT on a stale vid', async () => {
        const created = await createUser({ email: 'f2@example.com', password: 'pw' })
        await store.adminUsers.update(created.id, created.vid, { given_name: 'F' })
        await expect(() => store.adminUsers.delete(created.id, created.vid)).rejects.toMatchObject({
          code: 'admin.users.versionConflict',
        })
        // Row should still be present.
        expect(await store.adminUsers.getById(created.id)).toBeTruthy()
      })

      it('list applies pagination, order, and query filter', async () => {
        await createUser({ email: 'list1@example.com', password: 'pw', given_name: 'Aaron' })
        await createUser({ email: 'list2@example.com', password: 'pw', given_name: 'Bea' })
        await createUser({ email: 'list3@example.com', password: 'pw', given_name: 'Casey' })

        // Query filters against a stable, unique-to-this-test needle so
        // other test or dev rows don't skew the totals.
        const filtered = await store.adminUsers.list({
          page: 1,
          pageSize: 10,
          query: 'list',
          order: 'email',
          desc: false,
        })
        expect(filtered.length).toBe(3)

        const named = await store.adminUsers.list({
          page: 1,
          pageSize: 10,
          query: 'Bea',
          order: 'email',
          desc: false,
        })
        expect(named.length).toBe(1)
        expect(named[0]?.given_name).toBe('Bea')

        const total = await store.adminUsers.count({ query: 'list' })
        expect(total).toBe(3)
      })
    })

    // -------------------------------------------------------------------------
    // Admin roles + assignments
    // -------------------------------------------------------------------------

    describe('admin roles repository', () => {
      it('creates and reads a role', async () => {
        const role = await createRole({
          name: 'Editor',
          machine_name: 'test-editor',
          description: 'Can edit content',
        })
        expect(role.machine_name).toBe('test-editor')
        const byMachine = await store.adminRoles.getByMachineName('test-editor')
        expect(byMachine?.id).toBe(role.id)
      })

      it('assignToUser is idempotent and listRolesForUser returns the role', async () => {
        const user = await createUser({ email: 'g@example.com', password: 'pw' })
        const role = await createRole({ name: 'test-r', machine_name: 'test-r' })

        await store.adminRoles.assignToUser(role.id, user.id)
        await store.adminRoles.assignToUser(role.id, user.id) // idempotent

        const userRoles = await store.adminRoles.listRolesForUser(user.id)
        expect(userRoles.length).toBe(1)
        expect(userRoles[0]?.machine_name).toBe('test-r')

        const usersForRole = await store.adminRoles.listUsersForRole(role.id)
        expect(usersForRole).toEqual([user.id])
      })

      it('unassignFromUser removes the assignment', async () => {
        const user = await createUser({ email: 'h@example.com', password: 'pw' })
        const role = await createRole({ name: 'test-r', machine_name: 'test-r' })
        await store.adminRoles.assignToUser(role.id, user.id)
        await store.adminRoles.unassignFromUser(role.id, user.id)
        expect((await store.adminRoles.listRolesForUser(user.id)).length).toBe(0)
      })

      it('delete cascades to permissions and role-user assignments', async () => {
        const user = await createUser({ email: 'i@example.com', password: 'pw' })
        const role = await createRole({ name: 'test-r', machine_name: 'test-r' })
        await store.adminPermissions.grantAbility(role.id, 'a.one')
        await store.adminRoles.assignToUser(role.id, user.id)

        await store.adminRoles.delete(role.id, role.vid)
        trackedRoleIds.delete(role.id)

        // The role is gone…
        expect(await store.adminRoles.getById(role.id)).toBe(null)
        // …and its grants are gone…
        const grantsForRole = await store.adminPermissions.listAbilities(role.id)
        expect(grantsForRole.length).toBe(0)
        // …and no assignment for the role remains.
        const assignsForRole = await store.adminRoles.listUsersForRole(role.id)
        expect(assignsForRole.length).toBe(0)
        // The user still exists.
        expect(await store.adminUsers.getById(user.id)).toBeTruthy()
      })
    })

    // -------------------------------------------------------------------------
    // Admin permissions
    // -------------------------------------------------------------------------

    describe('admin permissions repository', () => {
      it('grantAbility is idempotent', async () => {
        const role = await createRole({ name: 'test-r', machine_name: 'test-r' })
        await store.adminPermissions.grantAbility(role.id, 'collections.pages.publish')
        await store.adminPermissions.grantAbility(role.id, 'collections.pages.publish')
        const abilities = await store.adminPermissions.listAbilities(role.id)
        expect(abilities).toEqual(['collections.pages.publish'])
      })

      it('revokeAbility removes the grant', async () => {
        const role = await createRole({ name: 'test-r', machine_name: 'test-r' })
        await store.adminPermissions.grantAbility(role.id, 'a.one')
        await store.adminPermissions.grantAbility(role.id, 'a.two')
        await store.adminPermissions.revokeAbility(role.id, 'a.one')
        const abilities = await store.adminPermissions.listAbilities(role.id)
        expect(abilities.sort()).toEqual(['a.two'])
      })

      it('setAbilities replaces the ability set wholesale', async () => {
        const role = await createRole({ name: 'test-r', machine_name: 'test-r' })
        await store.adminPermissions.grantAbility(role.id, 'a.one')
        await store.adminPermissions.grantAbility(role.id, 'a.two')
        await store.adminPermissions.setAbilities(role.id, ['a.three', 'a.four'])
        const abilities = await store.adminPermissions.listAbilities(role.id)
        expect(abilities.sort()).toEqual(['a.four', 'a.three'])
      })
    })

    // -------------------------------------------------------------------------
    // resolveActor
    // -------------------------------------------------------------------------

    describe('resolveActor', () => {
      it('returns null for unknown user ids', async () => {
        const actor = await resolveActor(store, '00000000-0000-7000-8000-000000000000')
        expect(actor).toBe(null)
      })

      it('returns null for disabled users', async () => {
        const user = await createUser({ email: 'j@example.com', password: 'pw' })
        // Created with is_enabled: false by default
        const actor = await resolveActor(store, user.id)
        expect(actor).toBe(null)
      })

      it('builds an AdminAuth with the union of abilities across roles', async () => {
        const user = await createUser({
          email: 'k@example.com',
          password: 'pw',
          is_enabled: true,
        })
        const roleA = await createRole({ name: 'A', machine_name: 'test-a' })
        const roleB = await createRole({ name: 'B', machine_name: 'test-b' })

        await store.adminPermissions.grantAbility(roleA.id, 'collections.pages.read')
        await store.adminPermissions.grantAbility(roleA.id, 'collections.pages.update')
        // Duplicate across roles — should collapse.
        await store.adminPermissions.grantAbility(roleB.id, 'collections.pages.update')
        await store.adminPermissions.grantAbility(roleB.id, 'collections.pages.publish')

        await store.adminRoles.assignToUser(roleA.id, user.id)
        await store.adminRoles.assignToUser(roleB.id, user.id)

        const actor = await resolveActor(store, user.id)
        expect(actor instanceof AdminAuth).toBeTruthy()
        expect(actor?.id).toBe(user.id)
        expect(actor?.isSuperAdmin).toBe(false)

        expect(actor?.hasAbility('collections.pages.read')).toBe(true)
        expect(actor?.hasAbility('collections.pages.update')).toBe(true)
        expect(actor?.hasAbility('collections.pages.publish')).toBe(true)
        expect(actor?.hasAbility('collections.pages.delete')).toBe(false)

        // Distinct — duplicates across roles collapse
        expect(actor?.abilities.size).toBe(3)
      })

      it('honours the is_super_admin flag', async () => {
        const user = await createUser({
          email: 'test-root@example.com',
          password: 'pw',
          is_super_admin: true,
          is_enabled: true,
        })
        const actor = await resolveActor(store, user.id)
        expect(actor).toBeTruthy()
        expect(actor?.isSuperAdmin).toBe(true)
        // Even without granting any abilities, super-admins pass every check
        expect(actor?.hasAbility('anything.at.all')).toBe(true)
      })
    })

    // -------------------------------------------------------------------------
    // seedSuperAdmin
    //
    // These tests use a test-specific role machine_name and email so the
    // idempotency assertions are not affected by (and do not affect) a
    // real dev-environment super-admin seed.
    // -------------------------------------------------------------------------

    describe('seedSuperAdmin', () => {
      const seedInput = {
        email: 'test-seed-super@example.com',
        password: 'initial-password',
        roleMachineName: 'test-seed-super-admin',
        roleName: 'Test Seed Super Admin',
      }

      it('creates role + user + assignment on first run', async () => {
        // Pre-clean in case a prior run left the seed in place.
        const existingUser = await store.adminUsers.getByEmail(seedInput.email)
        if (existingUser) await store.adminUsers.delete(existingUser.id, existingUser.vid)
        const existingRole = await store.adminRoles.getByMachineName(seedInput.roleMachineName)
        if (existingRole) await store.adminRoles.delete(existingRole.id, existingRole.vid)

        const result = await seedSuperAdmin(store, seedInput)
        trackUser(result.userId)
        trackRole(result.roleId)

        expect(result.userId).toBeTruthy()
        expect(result.roleId).toBeTruthy()
        expect(result.created).toEqual({ user: true, role: true, assignment: true })

        const actor = await resolveActor(store, result.userId)
        expect(actor).toBeTruthy()
        expect(actor?.isSuperAdmin).toBe(true)
      })

      it('is idempotent — second run reports nothing newly created', async () => {
        const existingUser = await store.adminUsers.getByEmail(seedInput.email)
        if (existingUser) await store.adminUsers.delete(existingUser.id, existingUser.vid)
        const existingRole = await store.adminRoles.getByMachineName(seedInput.roleMachineName)
        if (existingRole) await store.adminRoles.delete(existingRole.id, existingRole.vid)

        const first = await seedSuperAdmin(store, seedInput)
        trackUser(first.userId)
        trackRole(first.roleId)

        const second = await seedSuperAdmin(store, seedInput)
        expect(second.created).toEqual({
          user: false,
          role: false,
          assignment: false,
        })
      })
    })
  })
}

/**
 * Registers the admin-store conformance suites — `AdminPreferencesRepository`,
 * the built-in `JwtSessionProvider`, and the admin users/roles/permissions
 * repositories — behind `hooks.createAdminStore`. When the hook is absent
 * (an adapter that doesn't provide an `AdminStore`), this function returns
 * before registering a single `describe`/`it`, so the suites are cleanly
 * absent from the run rather than appearing as skipped. When the hook is
 * present, every test below runs — zero skips.
 */
export function adminStoreSuite(hooks: ConformanceHooks): void {
  const { createAdminStore } = hooks
  if (!createAdminStore) return

  adminPreferencesSuite(hooks, createAdminStore)
  sessionProviderSuite(hooks, createAdminStore)
  authIntegrationSuite(hooks, createAdminStore)
}
