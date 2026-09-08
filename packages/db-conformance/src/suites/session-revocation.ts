/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createHash, createHmac } from 'node:crypto'

import type { AdminStore } from '@byline/admin'
import { AdminAccountService } from '@byline/admin/admin-account'
import { AdminUsersService } from '@byline/admin/admin-users'
import { hashPassword, JwtSessionProvider } from '@byline/admin/auth'
import { v7 as uuidv7 } from 'uuid'
import { beforeAll, describe, expect, it } from 'vitest'

import { bounded, signal } from '../race-barrier.js'
import type { ConformanceHooks } from '../index.js'

const secret = 'session-revocation-test-secret-at-least-32-bytes'
const password = 'Old-password-123!'
const replacement = 'New-password-456!'

export function sessionRevocationSuite(hooks: ConformanceHooks): void {
  const createStore = hooks.createAdminStore
  if (!createStore) return
  describe('native session revocation', () => {
    let store: AdminStore
    let hash: string
    let nextHash: string
    beforeAll(async () => {
      await hooks.truncate()
      store = await createStore()
      hash = await hashPassword(password)
      nextHash = await hashPassword(replacement)
    })
    const providerFor = (s = store) => new JwtSessionProvider({ store: s, signingSecret: secret })
    async function fixture() {
      const user = await store.adminUsers.create({
        email: `${uuidv7()}@example.test`,
        password_hash: hash,
        is_enabled: true,
      })
      const provider = providerFor()
      const login = () => provider.signInWithPassword({ email: user.email, password })
      return { user, provider, login }
    }
    async function rejects(
      provider: JwtSessionProvider,
      tokens: { accessToken: string; refreshToken: string }
    ) {
      await expect(provider.verifyAccessToken(tokens.accessToken)).rejects.toThrow()
      await expect(provider.refreshSession({ refreshToken: tokens.refreshToken })).rejects.toThrow()
    }

    it('uncoordinated refresh contest revokes the affected login, including the winning access JWT', async () => {
      // Approved residual: coordination handles ordinary overlap; an escaped contest
      // fails closed for this login. Host tests separately require single-flight renewal.
      const { user, login } = await fixture()
      const tokens = await login()
      const bothObserved = signal()
      let arrivals = 0
      const racingStore: AdminStore = {
        ...store,
        async withSessionLock(id, work) {
          if (++arrivals === 2) bothObserved.release()
          await bounded(bothObserved.promise)
          return store.withSessionLock(id, work)
        },
      }
      const results = await Promise.allSettled([
        providerFor(racingStore).refreshSession({ refreshToken: tokens.refreshToken }),
        providerFor(racingStore).refreshSession({ refreshToken: tokens.refreshToken }),
      ])
      const successes = results.filter((result) => result.status === 'fulfilled')
      expect(successes).toHaveLength(1)
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
      expect(await store.refreshTokens.listActiveForUser(user.id)).toHaveLength(0)
      const winner = successes[0]
      if (winner?.status !== 'fulfilled') throw new Error('Expected one winning refresh')
      await expect(providerFor().verifyAccessToken(winner.value.accessToken)).rejects.toThrow()
      await expect(
        providerFor().refreshSession({ refreshToken: winner.value.refreshToken })
      ).rejects.toThrow()
    })

    it('logout from a rotated predecessor immediately rejects access and renewal for that login only', async () => {
      const { login, provider } = await fixture()
      const original = await login()
      const independent = await login()
      const rotated = await provider.refreshSession({ refreshToken: original.refreshToken })
      expect(rotated.sessionId).toBe(original.sessionId)
      expect(independent.sessionId).not.toBe(original.sessionId)
      await provider.revokeSession({ refreshToken: original.refreshToken })
      await rejects(provider, rotated)
      await provider.revokeSession({ refreshToken: original.refreshToken })
      expect((await provider.verifyAccessToken(independent.accessToken)).sessionId).toBe(
        independent.sessionId
      )
    })

    it('logout with only an access credential immediately revokes the login', async () => {
      const { login, provider } = await fixture()
      const current = await login()
      const independent = await login()
      await provider.revokeSession({
        accessToken: current.accessToken,
        expectedSessionId: current.sessionId,
      })
      await rejects(provider, current)
      await provider.verifyAccessToken(independent.accessToken)
    })

    it('logout cannot revoke a different observed login than the page expected', async () => {
      const { login, provider } = await fixture()
      const original = await login()
      const replacement = await login()
      await expect(
        provider.revokeSession({
          accessToken: replacement.accessToken,
          refreshToken: replacement.refreshToken,
          expectedSessionId: original.sessionId,
        })
      ).rejects.toMatchObject({ code: 'ERR_SESSION_CHANGED' })
      await provider.verifyAccessToken(original.accessToken)
      await provider.verifyAccessToken(replacement.accessToken)
    })

    it('replacement sign-in revokes observed cross-account credentials and preserves another device', async () => {
      const old = await fixture()
      const next = await fixture()
      const observed = await old.login()
      const otherDevice = await old.login()
      const replacement = await next.provider.signInWithPassword({
        email: next.user.email,
        password,
        previousAccessToken: observed.accessToken,
        previousRefreshToken: observed.refreshToken,
      })
      await rejects(old.provider, observed)
      await old.provider.verifyAccessToken(otherDevice.accessToken)
      expect((await next.provider.verifyAccessToken(replacement.accessToken)).actor.id).toBe(
        next.user.id
      )
    })

    it('failed replacement revocation rolls back and never returns new credentials', async () => {
      const old = await fixture()
      const next = await fixture()
      const observed = await old.login()
      const failing: AdminStore = {
        ...store,
        withSessionLocks: (ids, work) =>
          store.withSessionLocks(ids, (scoped) =>
            work({
              ...scoped,
              loginSessions: {
                ...scoped.loginSessions,
                async revoke(id, at) {
                  await scoped.loginSessions.revoke(id, at)
                  throw new Error('injected replacement revocation failure')
                },
              },
            })
          ),
      }
      await expect(
        providerFor(failing).signInWithPassword({
          email: next.user.email,
          password,
          previousRefreshToken: observed.refreshToken,
        })
      ).rejects.toThrow('injected')
      await old.provider.verifyAccessToken(observed.accessToken)
      expect(await store.refreshTokens.listActiveForUser(next.user.id)).toHaveLength(0)
    })

    it('revocation covers login membership beyond the former 1000-row traversal ceiling', async () => {
      const { user, login, provider } = await fixture()
      const original = await login()
      // Disconnected members prove authorization relies on membership, not rotated_to_id traversal.
      await store.withSessionLock(user.id, async (scoped) => {
        for (let n = 0; n < 1005; n++)
          await scoped.refreshTokens.issue({
            id: uuidv7(),
            admin_user_id: user.id,
            sid: original.sessionId,
            session_version: 0,
            token_hash: createHash('sha256').update(`${original.sessionId}-${n}`).digest('hex'),
            expires_at: new Date(Date.now() + 60000),
          })
      })
      await provider.revokeSession({ refreshToken: original.refreshToken })
      await expect(provider.verifyAccessToken(original.accessToken)).rejects.toThrow()
      expect(await store.refreshTokens.listActiveForUser(user.id)).toHaveLength(0)
    })

    it('access verification reads the user once and reuses that snapshot for actor resolution', async () => {
      const { login } = await fixture()
      const tokens = await login()
      let reads = 0
      const counted: AdminStore = {
        ...store,
        adminUsers: {
          ...store.adminUsers,
          async getById(id) {
            reads++
            return store.adminUsers.getById(id)
          },
          async getByIdForSignIn(id) {
            reads++
            return store.adminUsers.getByIdForSignIn(id)
          },
        },
      }
      await expect(
        providerFor(counted).verifyAccessToken(tokens.accessToken)
      ).resolves.toHaveProperty('actor')
      expect(reads).toBe(1)
    })

    it('requires an explicit generation even for untyped refresh issuance callers', async () => {
      const { user } = await fixture()
      const input = {
        id: uuidv7(),
        admin_user_id: user.id,
        token_hash: uuidv7(),
        expires_at: new Date(Date.now() + 60000),
      }
      // @ts-expect-error Missing generation must fail for TypeScript and JavaScript callers.
      await expect(store.refreshTokens.issue(input)).rejects.toThrow('session_version')
      expect(await store.refreshTokens.listAllForUser(user.id)).toHaveLength(0)
    })

    it('self-service revokes the changing session and two other sessions and requires the new password', async () => {
      const { user, provider, login } = await fixture()
      const sessions = [await login(), await login(), await login()]
      const account = new AdminAccountService({ repo: store.adminUsers })
      await account.changePassword(user.id, {
        vid: user.vid,
        currentPassword: password,
        newPassword: replacement,
      })
      for (const tokens of sessions) await rejects(provider, tokens)
      await expect(login()).rejects.toThrow()
      await expect(
        provider.signInWithPassword({ email: user.email, password: replacement })
      ).resolves.toHaveProperty('accessToken')
      expect(await store.refreshTokens.listActiveForUser(user.id)).toHaveLength(1)
    })

    it('wrong current password and stale revisions preserve credentials and sessions', async () => {
      const { user, provider, login } = await fixture()
      const tokens = await login()
      const service = new AdminAccountService({ repo: store.adminUsers })
      await expect(
        service.changePassword(user.id, {
          vid: user.vid,
          currentPassword: 'wrong',
          newPassword: replacement,
        })
      ).rejects.toThrow()
      await expect(
        service.changePassword(user.id, {
          vid: user.vid + 1,
          currentPassword: password,
          newPassword: replacement,
        })
      ).rejects.toThrow()
      expect((await store.adminUsers.getByIdForSignIn(user.id))?.session_version).toBe(0)
      await expect(provider.verifyAccessToken(tokens.accessToken)).resolves.toHaveProperty('actor')
      await expect(
        provider.refreshSession({ refreshToken: tokens.refreshToken })
      ).resolves.toHaveProperty('accessToken')
    })

    it('administrator reset revokes native sessions', async () => {
      const { user, provider, login } = await fixture()
      const tokens = await login()
      await new AdminUsersService({ repo: store.adminUsers }).setPassword({
        id: user.id,
        vid: user.vid,
        password: replacement,
      })
      await rejects(provider, tokens)
    })

    for (const path of ['setEnabled', 'update'] as const) {
      it(`disable through ${path} and re-enable never revive old access or refresh tokens`, async () => {
        const { user, provider, login } = await fixture()
        const tokens = await login()
        if (path === 'setEnabled') await store.adminUsers.setEnabled(user.id, false)
        else await store.adminUsers.update(user.id, user.vid, { is_enabled: false })
        await rejects(provider, tokens)
        await store.adminUsers.setEnabled(user.id, true)
        await rejects(provider, tokens)
        await expect(login()).resolves.toHaveProperty('accessToken')
      })
    }

    it('transaction failure rolls back password, generation, and refresh revocation', async () => {
      const { user, provider, login } = await fixture()
      const tokens = await login()
      await expect(
        store.withSessionLock(user.id, async (scoped) => {
          await scoped.adminUsers.setPasswordHash(user.id, user.vid, nextHash)
          // A real database constraint failure after the password and revocation writes.
          await scoped.refreshTokens.issue({
            id: uuidv7(),
            admin_user_id: uuidv7(),
            token_hash: uuidv7(),
            session_version: 0,
            expires_at: new Date(Date.now() + 60000),
          })
        })
      ).rejects.toThrow()
      const current = await store.adminUsers.getByIdForSignIn(user.id)
      expect(current?.password_hash).toBe(hash)
      expect(current?.session_version).toBe(0)
      expect(current?.vid).toBe(user.vid)
      await expect(provider.verifyAccessToken(tokens.accessToken)).resolves.toHaveProperty('actor')
      await expect(
        provider.refreshSession({ refreshToken: tokens.refreshToken })
      ).resolves.toHaveProperty('accessToken')
    })

    for (const operation of ['sign-in', 'refresh'] as const) {
      for (const mutation of ['password', 'disable-reenable'] as const) {
        it(`${operation} observed before committed ${mutation} cannot issue from old state`, async () => {
          const { user, login } = await fixture()
          const tokens = await login()
          const reached = signal(),
            resume = signal()
          const delayed: AdminStore = {
            ...store,
            async withSessionLock(id, work) {
              reached.release()
              await bounded(resume.promise)
              return store.withSessionLock(id, work)
            },
          }
          const provider = providerFor(delayed)
          const pending = (
            operation === 'sign-in'
              ? provider.signInWithPassword({ email: user.email, password })
              : provider.refreshSession({ refreshToken: tokens.refreshToken })
          ).then(
            () => 'issued',
            () => 'rejected'
          )
          await bounded(reached.promise)
          try {
            if (mutation === 'password')
              await store.adminUsers.setPasswordHash(user.id, user.vid, nextHash)
            else {
              await store.adminUsers.setEnabled(user.id, false)
              await store.adminUsers.setEnabled(user.id, true)
            }
          } finally {
            resume.release()
          }
          expect(await pending).toBe('rejected')
          expect(await store.refreshTokens.listActiveForUser(user.id)).toHaveLength(0)
        })
      }
    }

    for (const operation of ['sign-in', 'refresh'] as const) {
      it(`${operation} that commits first is subsequently revoked, with two physical connections`, async () => {
        const { user, login } = await fixture()
        const original = await login()
        const reached = signal(),
          resume = signal()
        const delayed: AdminStore = {
          ...store,
          withSessionLock: (id, work) =>
            store.withSessionLock(id, async (scoped, row) => {
              const outcome = await work(scoped, row)
              reached.release()
              await bounded(resume.promise)
              return outcome
            }),
        }
        if (!hooks.observeSingletonContention) throw new Error('connection observer required')
        const observation = await hooks.observeSingletonContention(async (twoConnections) => {
          const provider = providerFor(delayed)
          const pending =
            operation === 'sign-in'
              ? provider.signInWithPassword({ email: user.email, password })
              : provider.refreshSession({ refreshToken: original.refreshToken })
          await bounded(reached.promise)
          const mutation = store.adminUsers.setPasswordHash(user.id, user.vid, nextHash)
          try {
            await bounded(twoConnections())
          } finally {
            resume.release()
          }
          const tokens = await pending
          await mutation
          await rejects(providerFor(), tokens)
        })
        expect(observation.maxConcurrentConnections).toBeGreaterThanOrEqual(2)
        expect(await store.refreshTokens.listActiveForUser(user.id)).toHaveLength(0)
      })
    }

    it('rejects missing, malformed, negative, and future access generations and legacy refresh rows', async () => {
      const { user, provider } = await fixture()
      for (const sv of [undefined, null, '0', -1, 0.5, 1]) {
        const head = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')
        const body = Buffer.from(
          JSON.stringify({
            typ: 'access',
            sv,
            sub: user.id,
            iss: 'byline',
            exp: Math.floor(Date.now() / 1000) + 900,
          })
        ).toString('base64url')
        const signed = `${head}.${body}`
        const token = `${signed}.${createHmac('sha256', secret).update(signed).digest('base64url')}`
        await expect(provider.verifyAccessToken(token)).rejects.toThrow()
      }
      const plain = uuidv7()
      await store.refreshTokens.issue({
        id: uuidv7(),
        admin_user_id: user.id,
        token_hash: createHash('sha256').update(plain).digest('hex'),
        session_version: -1, // Explicit legacy fixture; native issuance always supplies current generation.
        expires_at: new Date(Date.now() + 60000),
      })
      await expect(provider.refreshSession({ refreshToken: plain })).rejects.toThrow()
    })

    it('successive password changes in the same JWT second invalidate each generation', async () => {
      const { user } = await fixture()
      const now = new Date(Math.floor(Date.now() / 1000) * 1000)
      const provider = new JwtSessionProvider({ store, signingSecret: secret, now: () => now })
      const first = await provider.signInWithPassword({ email: user.email, password })
      const changed = await store.adminUsers.setPasswordHash(user.id, user.vid, nextHash)
      const second = await provider.signInWithPassword({ email: user.email, password: replacement })
      await store.adminUsers.setPasswordHash(user.id, changed.vid, hash)
      await rejects(provider, first)
      await rejects(provider, second)
      await expect(
        provider.signInWithPassword({ email: user.email, password })
      ).resolves.toHaveProperty('accessToken')
    })
  })
}
