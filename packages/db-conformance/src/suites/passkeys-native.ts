/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createHash } from 'node:crypto'

import type { AdminStore } from '@byline/admin'
import { hashPassword, JwtSessionProvider, type NativeSessionEvent } from '@byline/admin/auth'
import type { PasskeyManagementAction, PasskeyProvider, PasskeySession } from '@byline/auth'
import { v7 as uuidv7 } from 'uuid'
import { beforeAll, describe, expect, it } from 'vitest'

import { type CeremonyOverrides, passkeyAuthenticator } from '../fixtures/passkey-authenticator.js'
import { bounded } from '../race-barrier.js'
import type { ConformanceHooks } from '../index.js'

const password = 'Passkey-conformance-password-123!'
const signingSecret = 'passkey-conformance-secret-with-at-least-32-bytes'
const trust = { rpId: 'example.test', rpName: 'Test CMS', origins: ['https://cms.example.test'] }
const digest = (raw: string) => createHash('sha256').update(raw).digest('hex')

export function passkeysNativeSuite(hooks: ConformanceHooks): void {
  const createStore = hooks.createAdminStore
  if (!createStore) return
  const readAudit = hooks.readPasskeyAudit
  if (!readAudit) throw new Error('Native passkey conformance requires committed audit observation')
  describe('native passkeys', () => {
    let store: AdminStore
    let hash: string
    beforeAll(async () => {
      await hooks.truncate()
      store = await createStore()
      hash = await hashPassword(password)
    })
    const providerFor = (
      s = store,
      onEvent?: (event: NativeSessionEvent) => void,
      now?: () => Date
    ) => {
      const provider = new JwtSessionProvider({
        store: s,
        signingSecret,
        passkeys: trust,
        onEvent,
        now,
      })
      if (!provider.passkeys) throw new Error('Expected configured passkeys')
      return provider as JwtSessionProvider & { passkeys: PasskeyProvider }
    }

    async function fixture(superAdmin = false) {
      const user = await store.adminUsers.create({
        email: `${uuidv7()}@example.test`,
        password_hash: hash,
        is_enabled: true,
        is_super_admin: superAdmin,
      })
      const provider = providerFor()
      const tokens = await provider.signInWithPassword({ email: user.email, password })
      const session: PasskeySession = {
        accessToken: tokens.accessToken,
        expectedSessionId: tokens.sessionId,
      }
      const proof = (action: PasskeyManagementAction = { purpose: 'enroll' }) =>
        provider.passkeys.passwordProof({ ...session, password, action })
      async function enrollment(multiDevice = false) {
        const grant = await proof()
        const ceremony = await provider.passkeys.enrollmentOptions({
          ...session,
          grantId: grant.grantId,
        })
        const device = passkeyAuthenticator(multiDevice)
        const key = await provider.passkeys.verifyEnrollment({
          ...session,
          ceremonyId: ceremony.ceremonyId,
          response: device.registration(ceremony.options),
          name: 'My device',
        })
        return { device, key, handle: ceremony.options.user.id }
      }
      return { user, provider, tokens, session, proof, enrollment }
    }
    async function attempt(
      f: Awaited<ReturnType<typeof fixture>>,
      key: Awaited<ReturnType<typeof f.enrollment>>,
      overrides?: CeremonyOverrides
    ) {
      const ceremony = await f.provider.passkeys.signInOptions({})
      return {
        ceremonyId: ceremony.ceremonyId,
        response: key.device.authentication(ceremony.options, key.handle, overrides),
      }
    }
    async function generation(id: string) {
      const user = await store.adminUsers.getByIdForSignIn(id)
      if (!user) throw new Error('Expected test account')
      return user.session_version
    }
    // A completed delegated grant would observe this durable generation, independently
    // of the browser login. No MCP/OAuth implementation is needed for this boundary.
    async function delegatedObservation(id: string) {
      const captured = await generation(id)
      return async () => (await generation(id)) === captured
    }
    async function invalidated(
      provider: JwtSessionProvider,
      tokens: { accessToken: string; refreshToken: string }
    ) {
      await expect(provider.verifyAccessToken(tokens.accessToken)).rejects.toThrow()
      await expect(provider.refreshSession({ refreshToken: tokens.refreshToken })).rejects.toThrow()
    }
    function atNextLock(work: () => Promise<void>): AdminStore {
      let pending = true
      const runInterleaving = async () => {
        if (pending) {
          pending = false
          await work()
        }
      }
      return {
        ...store,
        async withSessionLock(id, run) {
          await runInterleaving()
          return store.withSessionLock(id, run)
        },
        async withSessionLocks(ids, run) {
          await runInterleaving()
          return store.withSessionLocks(ids, run)
        },
      }
    }

    it('keeps password-only capability and public access verification free of credential material', async () => {
      const f = await fixture()
      const plain = new JwtSessionProvider({ store, signingSecret })
      expect(plain.passkeys).toBeUndefined()
      expect(plain.capabilities.passkeys).toBeUndefined()
      expect(Object.keys(await plain.verifyAccessToken(f.tokens.accessToken)).sort()).toEqual([
        'actor',
        'sessionId',
      ])
      expect(Reflect.ownKeys(JwtSessionProvider.prototype)).not.toContain('issueTokens')
    })

    it('enrolls a discoverable key, signs in, and keeps summaries private', async () => {
      const f = await fixture()
      const delegatedValid = await delegatedObservation(f.user.id)
      const key = await f.enrollment()
      const originalHandle = key.handle
      const signedIn = await f.provider.passkeys.verifySignIn(await attempt(f, key))
      expect(signedIn.actor.id).toBe(f.user.id)
      expect(signedIn.sessionId).not.toBe(f.tokens.sessionId)
      expect(Object.keys(key.key).sort()).toEqual(['createdAt', 'id', 'lastUsedAt', 'name'])
      await f.provider.passkeys.renameCredential({
        ...f.session,
        credentialRecordId: key.key.id,
        name: '<b>Phone</b>',
      })
      expect(await delegatedValid()).toBe(true)
      const another = await f.enrollment()
      expect(another.handle).toBe(originalHandle)
      await f.provider.revokeSession({
        accessToken: signedIn.accessToken,
        expectedSessionId: signedIn.sessionId,
      })
      expect(await delegatedValid()).toBe(true)
      await f.provider.verifyAccessToken(f.tokens.accessToken)
    })

    it.each([false, true])('supports repeated zero counters (multi-device=%s)', async (multi) => {
      const f = await fixture()
      const key = await f.enrollment(multi)
      for (let n = 0; n < 2; n++)
        await f.provider.passkeys.verifySignIn(await attempt(f, key, { backedUp: multi }))
      expect(await store.passkeys.findCredential(key.key.id)).toMatchObject({
        counter: 0,
        backup_eligible: multi,
        backed_up: multi,
      })
    })

    it('consumes failed proofs once and rejects a non-increasing positive counter', async () => {
      const f = await fixture()
      const key = await f.enrollment()
      await f.provider.passkeys.verifySignIn(await attempt(f, key, { counter: 1 }))
      const stale = await attempt(f, key, { counter: 1 })
      await expect(f.provider.passkeys.verifySignIn(stale)).rejects.toThrow()
      await expect(f.provider.passkeys.verifySignIn(stale)).rejects.toThrow('already used')
      expect(
        (await store.passkeys.findAttempt(digest(stale.ceremonyId)))?.consumed_at
      ).toBeInstanceOf(Date)
    })

    const invalidCases: [string, CeremonyOverrides][] = [
      ['wrong origin', { origin: 'https://evil.example.test' }],
      ['wrong challenge', { challenge: 'wrong-challenge' }],
      ['wrong RP', { rpId: 'evil.test' }],
      ['wrong type', { type: 'payment.get' }],
      ['missing UV', { userVerified: false }],
      ['cross origin', { crossOrigin: true }],
      ['malformed cross origin', { crossOrigin: 'false' }],
    ]
    it.each(invalidCases)(
      'rejects %s for registration and authentication',
      async (_name, overrides) => {
        const f = await fixture()
        const key = await f.enrollment()
        await expect(
          f.provider.passkeys.verifySignIn(await attempt(f, key, overrides))
        ).rejects.toThrow()
        const grant = await f.proof()
        const registration = await f.provider.passkeys.enrollmentOptions({
          ...f.session,
          grantId: grant.grantId,
        })
        await expect(
          f.provider.passkeys.verifyEnrollment({
            ...f.session,
            ceremonyId: registration.ceremonyId,
            name: 'Bad',
            response: passkeyAuthenticator().registration(registration.options, overrides),
          })
        ).rejects.toThrow()
        expect(await store.passkeys.listCredentials(f.user.id)).toHaveLength(1)
      }
    )

    it.each(['absent', 'false', 'true'] as const)(
      'handles credProps %s while requiring discoverable creation',
      async (reported) => {
        const f = await fixture()
        const grant = await f.proof()
        const options = await f.provider.passkeys.enrollmentOptions({
          ...f.session,
          grantId: grant.grantId,
        })
        expect(options.options.authenticatorSelection).toEqual({
          residentKey: 'required',
          requireResidentKey: true,
          userVerification: 'required',
        })
        const response = passkeyAuthenticator().registration(options.options)
        const clientExtensionResults =
          reported === 'absent' ? {} : { credProps: { rk: reported === 'true' } }
        const result = f.provider.passkeys.verifyEnrollment({
          ...f.session,
          ceremonyId: options.ceremonyId,
          response: { ...response, clientExtensionResults },
          name: 'Resident key',
        })
        if (reported === 'false') {
          await expect(result).rejects.toMatchObject({ code: 'ERR_INVALID_CREDENTIALS' })
          expect(await store.passkeys.listCredentials(f.user.id)).toHaveLength(0)
        } else {
          await expect(result).resolves.toHaveProperty('id')
          expect(await store.passkeys.listCredentials(f.user.id)).toHaveLength(1)
        }
      }
    )

    it('accepts omitted crossOrigin in both ceremonies without rewriting signed data', async () => {
      const f = await fixture()
      const grant = await f.proof()
      const registration = await f.provider.passkeys.enrollmentOptions({
        ...f.session,
        grantId: grant.grantId,
      })
      const device = passkeyAuthenticator()
      await f.provider.passkeys.verifyEnrollment({
        ...f.session,
        ceremonyId: registration.ceremonyId,
        name: 'Key',
        response: device.registration(registration.options, { omitCrossOrigin: true }),
      })
      const ceremony = await f.provider.passkeys.signInOptions({})
      await f.provider.passkeys.verifySignIn({
        ceremonyId: ceremony.ceremonyId,
        response: device.authentication(ceremony.options, registration.options.user.id, {
          omitCrossOrigin: true,
        }),
      })
    })

    it('rejects mismatched handles, corrupt signatures, and revoked or ownerless credential identities', async () => {
      const f = await fixture()
      const key = await f.enrollment()
      const other = await fixture()
      const otherKey = await other.enrollment()
      await expect(
        f.provider.passkeys.verifySignIn(await attempt(f, key, { userHandle: otherKey.handle }))
      ).rejects.toThrow()
      const corrupt = await attempt(f, key)
      corrupt.response.response.signature = Buffer.alloc(64).toString('base64url')
      await expect(f.provider.passkeys.verifySignIn(corrupt)).rejects.toThrow()
      await store.withSessionLock(f.user.id, (scoped) =>
        scoped.passkeys.revokeCredential(key.key.id, new Date())
      )
      await expect(f.provider.passkeys.verifySignIn(await attempt(f, key))).rejects.toThrow()
      const row = (await store.adminUsers.getById(other.user.id))!
      await store.adminUsers.delete(other.user.id, row.vid)
      await expect(
        other.provider.passkeys.verifySignIn(await attempt(other, otherKey))
      ).rejects.toThrow()
    })

    it('fresh passkey proof binds the acting login and never issues a login', async () => {
      const f = await fixture()
      const key = await f.enrollment()
      const other = await fixture()
      const otherKey = await other.enrollment()
      const before = await store.refreshTokens.listActiveForUser(f.user.id)
      const proof = await f.provider.passkeys.proofOptions({
        ...f.session,
        action: { purpose: 'enroll' },
      })
      await expect(
        f.provider.passkeys.verifyProof({
          ...f.session,
          ceremonyId: proof.ceremonyId,
          response: otherKey.device.authentication(proof.options, otherKey.handle),
        })
      ).rejects.toThrow()
      const own = await f.provider.passkeys.proofOptions({
        ...f.session,
        action: { purpose: 'enroll' },
      })
      const grant = await f.provider.passkeys.verifyProof({
        ...f.session,
        ceremonyId: own.ceremonyId,
        response: key.device.authentication(own.options, key.handle),
      })
      expect(await store.refreshTokens.listActiveForUser(f.user.id)).toHaveLength(before.length)
      await store.withSessionLock(f.user.id, (scoped) =>
        scoped.passkeys.revokeCredential(key.key.id, new Date())
      )
      await expect(
        f.provider.passkeys.enrollmentOptions({ ...f.session, grantId: grant.grantId })
      ).rejects.toThrow()
    })

    it('keeps grant purposes separate and preserves the original enrollment deadline', async () => {
      const f = await fixture()
      const key = await f.enrollment()
      const grant = await f.proof()
      await expect(
        f.provider.passkeys.removeCredential({ ...f.session, grantId: grant.grantId })
      ).rejects.toThrow()
      const later = new Date(Date.parse(grant.expiresAt) - 1_000)
      const provider = providerFor(store, undefined, () => later)
      const options = await provider.passkeys.enrollmentOptions({
        ...f.session,
        grantId: grant.grantId,
      })
      expect(options.expiresAt).toBe(grant.expiresAt)
      await expect(
        provider.passkeys.enrollmentOptions({ ...f.session, grantId: grant.grantId })
      ).rejects.toThrow()
      const remove = await f.proof({
        purpose: 'remove',
        targetUserId: f.user.id,
        credentialRecordId: key.key.id,
      })
      await expect(
        f.provider.passkeys.enrollmentOptions({ ...f.session, grantId: remove.grantId })
      ).rejects.toThrow()
      await expect(
        f.provider.passkeys.verifyProof({
          ...f.session,
          ceremonyId: options.ceremonyId,
          response: {},
        })
      ).rejects.toThrow()
      const expired = providerFor(store, undefined, () => new Date(Date.parse(options.expiresAt)))
      await expect(
        expired.passkeys.verifyEnrollment({
          ...f.session,
          ceremonyId: options.ceremonyId,
          response: passkeyAuthenticator().registration(options.options),
          name: 'Too late',
        })
      ).rejects.toThrow()
    })

    it('requires the expected live login and caps combined pending authority', async () => {
      const f = await fixture()
      await expect(
        f.provider.passkeys.passwordProof({
          ...f.session,
          expectedSessionId: uuidv7(),
          password,
          action: { purpose: 'enroll' },
        })
      ).rejects.toThrow()
      await expect(
        f.provider.passkeys.passwordProof({
          ...f.session,
          password: 'Wrong-password',
          action: { purpose: 'enroll' },
        })
      ).rejects.toThrow()
      for (let i = 0; i < 5; i++)
        await f.provider.passkeys.proofOptions({ ...f.session, action: { purpose: 'enroll' } })
      await expect(f.proof()).rejects.toMatchObject({ code: 'ERR_PASSKEY_LIMIT' })
      await f.provider.revokeSession({
        accessToken: f.tokens.accessToken,
        expectedSessionId: f.tokens.sessionId,
      })
      await expect(f.provider.passkeys.listCredentials(f.session)).rejects.toThrow()
    })

    it.each(['counter', 'removal', 'password reset', 'disable/re-enable'] as const)(
      'rejects %s between crypto verification and the account lock',
      async (change) => {
        const f = await fixture()
        const key = await f.enrollment()
        const args = await attempt(f, key, { counter: 1 })
        const racing = atNextLock(async () => {
          if (change === 'counter')
            await store.withSessionLock(f.user.id, (scoped) =>
              scoped.passkeys.updateCredential(key.key.id, { counter: 1 })
            )
          if (change === 'removal')
            await store.withSessionLock(f.user.id, (scoped) =>
              scoped.passkeys.revokeCredential(key.key.id, new Date())
            )
          if (change === 'password reset') {
            const user = (await store.adminUsers.getById(f.user.id))!
            await store.adminUsers.setPasswordHash(user.id, user.vid, hash)
          }
          if (change === 'disable/re-enable') {
            await store.adminUsers.setEnabled(f.user.id, false)
            await store.adminUsers.setEnabled(f.user.id, true)
          }
        })
        await expect(providerFor(racing).passkeys.verifySignIn(args)).rejects.toThrow()
        expect(
          (await store.passkeys.findAttempt(digest(args.ceremonyId)))?.consumed_at
        ).toBeInstanceOf(Date)
      }
    )

    it('rechecks password proof and enrollment authority after replacement sign-in', async () => {
      const f = await fixture()
      const replacement = () =>
        f.provider
          .signInWithPassword({
            email: f.user.email,
            password,
            previousAccessToken: f.tokens.accessToken,
          })
          .then(() => {})
      await expect(
        providerFor(atNextLock(replacement)).passkeys.passwordProof({
          ...f.session,
          password,
          action: { purpose: 'enroll' },
        })
      ).rejects.toThrow()
      const next = await fixture()
      const grant = await next.proof()
      const options = await next.provider.passkeys.enrollmentOptions({
        ...next.session,
        grantId: grant.grantId,
      })
      const replacing = atNextLock(() =>
        next.provider
          .signInWithPassword({
            email: next.user.email,
            password,
            previousAccessToken: next.tokens.accessToken,
          })
          .then(() => {})
      )
      await expect(
        providerFor(replacing).passkeys.verifyEnrollment({
          ...next.session,
          ceremonyId: options.ceremonyId,
          response: passkeyAuthenticator().registration(options.options),
          name: 'Lost authority',
        })
      ).rejects.toThrow()
      expect(await store.passkeys.listCredentials(next.user.id)).toHaveLength(0)
    })

    it('passkey replacement revokes only observed logins and commits the counter with issuance', async () => {
      const old = await fixture()
      const target = await fixture()
      const key = await target.enrollment()
      const result = await target.provider.passkeys.verifySignIn({
        ...(await attempt(target, key, { counter: 1 })),
        previousAccessToken: old.tokens.accessToken,
        previousRefreshToken: old.tokens.refreshToken,
      })
      await invalidated(old.provider, old.tokens)
      await target.provider.verifyAccessToken(target.tokens.accessToken)
      expect(result.actor.id).toBe(target.user.id)
      expect((await store.passkeys.findCredential(key.key.id))?.counter).toBe(1)
    })

    it('rolls counter and replacement revocation back on issuance failure, but never restores the attempt', async () => {
      const old = await fixture()
      const f = await fixture()
      const key = await f.enrollment()
      const events: NativeSessionEvent[] = []
      const failing: AdminStore = {
        ...store,
        withSessionLocks: (ids, work) =>
          store.withSessionLocks(ids, (scoped) =>
            work({
              ...scoped,
              refreshTokens: {
                ...scoped.refreshTokens,
                async issue(input) {
                  await scoped.refreshTokens.issue(input)
                  throw new Error('secret-driver-payload')
                },
              },
            })
          ),
      }
      const args = await attempt(f, key, { counter: 1 })
      await expect(
        providerFor(failing, (e) => {
          events.push(e)
        }).passkeys.verifySignIn({ ...args, previousAccessToken: old.tokens.accessToken })
      ).rejects.toThrow('Passkey service unavailable')
      await old.provider.verifyAccessToken(old.tokens.accessToken)
      expect((await store.passkeys.findCredential(key.key.id))?.counter).toBe(0)
      expect(
        (await store.passkeys.findAttempt(digest(args.ceremonyId)))?.consumed_at
      ).toBeInstanceOf(Date)
      expect(events).toEqual([
        { type: 'passkey_attempted', purpose: 'sign-in' },
        { type: 'passkey_failed', purpose: 'sign-in', reason: 'unavailable' },
      ])
    })

    it('self-removal invalidates every target login and delegated observation at commit', async () => {
      const f = await fixture()
      const key = await f.enrollment()
      const valid = await delegatedObservation(f.user.id)
      const extra = await f.provider.passkeys.verifySignIn(await attempt(f, key))
      const pending = await f.proof()
      const grant = await f.proof({
        purpose: 'remove',
        targetUserId: f.user.id,
        credentialRecordId: key.key.id,
      })
      expect(
        await f.provider.passkeys.removeCredential({ ...f.session, grantId: grant.grantId })
      ).toEqual({ signedOut: true })
      expect(await valid()).toBe(false)
      expect(await generation(f.user.id)).toBe(1)
      await invalidated(f.provider, f.tokens)
      await invalidated(f.provider, extra)
      await expect(
        f.provider.passkeys.enrollmentOptions({ ...f.session, grantId: pending.grantId })
      ).rejects.toThrow()
      expect(await store.passkeys.getUserHandle(f.user.id)).toBe(key.handle)
    })

    it('requires managePasskeys independently and protects super-admin targets', async () => {
      const actor = await fixture()
      const target = await fixture(true)
      const key = await target.enrollment()
      const action: PasskeyManagementAction = {
        purpose: 'remove',
        targetUserId: target.user.id,
        credentialRecordId: key.key.id,
      }
      await expect(actor.proof(action)).rejects.toThrow()
      const abilities = ['admin.users.read', 'admin.users.update', 'admin.users.changePassword']
      const withAbilities = (items: string[]): AdminStore => {
        const wrap = (scoped: AdminStore): AdminStore => ({
          ...scoped,
          adminPermissions: { ...scoped.adminPermissions, listAbilitiesForUser: async () => items },
        })
        return {
          ...wrap(store),
          withSessionLock: (id, work) =>
            store.withSessionLock(id, (scoped, user) => work(wrap(scoped), user)),
          withSessionLocks: (ids, work) =>
            store.withSessionLocks(ids, (scoped) => work(wrap(scoped))),
        }
      }
      for (const items of [abilities, ['admin.users.managePasskeys']]) {
        const provider = providerFor(withAbilities(items))
        await expect(
          provider.passkeys.listCredentials({ ...actor.session, targetUserId: target.user.id })
        ).rejects.toThrow()
        await expect(
          provider.passkeys.passwordProof({ ...actor.session, password, action })
        ).rejects.toThrow()
      }
    })

    it('privileged removal can recover a disabled target and preserves the acting account', async () => {
      const actor = await fixture(true)
      const target = await fixture()
      const key = await target.enrollment()
      await store.adminUsers.setEnabled(target.user.id, false)
      const generationBefore = await generation(target.user.id)
      expect(
        await actor.provider.passkeys.listCredentials({
          ...actor.session,
          targetUserId: target.user.id,
        })
      ).toHaveLength(1)
      const grant = await actor.proof({
        purpose: 'remove',
        targetUserId: target.user.id,
        credentialRecordId: key.key.id,
      })
      expect(
        await actor.provider.passkeys.removeCredential({
          ...actor.session,
          grantId: grant.grantId,
        })
      ).toEqual({ signedOut: false })
      expect(await generation(target.user.id)).toBe(generationBefore + 1)
      expect(await generation(actor.user.id)).toBe(0)
      await actor.provider.verifyAccessToken(actor.tokens.accessToken)
      expect(await readAudit(actor.user.id)).toEqual([
        {
          actorId: actor.user.id,
          action: 'admin.passkey.remove',
          after: {
            targetUserId: target.user.id,
            credentialRecordId: key.key.id,
            outcome: 'success',
          },
        },
      ])
    })

    it('audit insertion failure rolls removal and generation back while consuming the grant', async () => {
      const actor = await fixture(true)
      const target = await fixture()
      const key = await target.enrollment()
      const valid = await delegatedObservation(target.user.id)
      const grant = await actor.proof({
        purpose: 'remove',
        targetUserId: target.user.id,
        credentialRecordId: key.key.id,
      })
      const events: NativeSessionEvent[] = []
      const failing: AdminStore = {
        ...store,
        withSessionLocks: (ids, work) =>
          store.withSessionLocks(ids, (scoped) =>
            work({
              ...scoped,
              passkeys: {
                ...scoped.passkeys,
                async appendRemovalAudit(input) {
                  await scoped.passkeys.appendRemovalAudit(input)
                  throw new Error('injected audit failure')
                },
              },
            })
          ),
      }
      await expect(
        providerFor(failing, (e) => {
          events.push(e)
        }).passkeys.removeCredential({ ...actor.session, grantId: grant.grantId })
      ).rejects.toThrow('unavailable')
      expect((await store.passkeys.findCredential(key.key.id))?.revoked_at).toBeNull()
      expect(await valid()).toBe(true)
      await target.provider.verifyAccessToken(target.tokens.accessToken)
      await actor.provider.verifyAccessToken(actor.tokens.accessToken)
      expect((await store.passkeys.findAttempt(digest(grant.grantId)))?.consumed_at).toBeInstanceOf(
        Date
      )
      expect(events.filter((event) => event.type === 'passkey_completed')).toEqual([])
      expect(await readAudit(actor.user.id)).toEqual([
        {
          actorId: actor.user.id,
          action: 'admin.passkey.remove',
          after: {
            targetUserId: target.user.id,
            credentialRecordId: key.key.id,
            outcome: 'failed',
          },
        },
      ])
    })

    it('rechecks privileged authority under the removal locks and persists a denial separately', async () => {
      const actor = await fixture(true)
      const target = await fixture()
      const key = await target.enrollment()
      const grant = await actor.proof({
        purpose: 'remove',
        targetUserId: target.user.id,
        credentialRecordId: key.key.id,
      })
      const changed = atNextLock(async () => {
        const user = await store.adminUsers.getById(actor.user.id)
        if (!user) throw new Error('Expected actor')
        await store.adminUsers.update(user.id, user.vid, { is_super_admin: false })
      })
      await expect(
        providerFor(changed).passkeys.removeCredential({ ...actor.session, grantId: grant.grantId })
      ).rejects.toMatchObject({ code: 'ERR_FORBIDDEN' })
      expect((await store.passkeys.findCredential(key.key.id))?.revoked_at).toBeNull()
      expect(await generation(target.user.id)).toBe(0)
      expect(await readAudit(actor.user.id)).toEqual([
        {
          actorId: actor.user.id,
          action: 'admin.passkey.remove',
          after: {
            targetUserId: target.user.id,
            credentialRecordId: key.key.id,
            outcome: 'denied',
          },
        },
      ])
    })

    it('rechecks the credential cap at enrollment completion and retains credential identities', async () => {
      const f = await fixture()
      const key = await f.enrollment()
      const source = await store.passkeys.findCredential(key.key.id)
      if (!source) throw new Error('Expected enrolled credential')
      const grant = await f.proof()
      const options = await f.provider.passkeys.enrollmentOptions({
        ...f.session,
        grantId: grant.grantId,
      })
      await store.withSessionLock(f.user.id, async (scoped) => {
        for (let i = 0; i < 9; i++)
          await scoped.passkeys.createCredential({
            ...source,
            admin_user_id: f.user.id,
            id: uuidv7(),
            credential_id: Buffer.from(uuidv7()).toString('base64url'),
          })
      })
      await expect(
        f.provider.passkeys.verifyEnrollment({
          ...f.session,
          ceremonyId: options.ceremonyId,
          name: 'Eleventh',
          response: passkeyAuthenticator().registration(options.options),
        })
      ).rejects.toMatchObject({ code: 'ERR_PASSKEY_LIMIT' })
      expect(await store.passkeys.listCredentials(f.user.id)).toHaveLength(10)
      await store.withSessionLock(f.user.id, (scoped) =>
        scoped.passkeys.revokeCredential(key.key.id, new Date())
      )
      const next = await f.proof()
      const reenroll = await f.provider.passkeys.enrollmentOptions({
        ...f.session,
        grantId: next.grantId,
      })
      await expect(
        f.provider.passkeys.verifyEnrollment({
          ...f.session,
          ceremonyId: reenroll.ceremonyId,
          name: 'Reassigned',
          response: key.device.registration(reenroll.options),
        })
      ).rejects.toThrow()
    })

    it('admits exactly one of two positive-counter proofs verified before either account lock', async () => {
      const f = await fixture()
      const key = await f.enrollment()
      const first = await attempt(f, key, { counter: 1 })
      const second = await attempt(f, key, { counter: 1 })
      let arrived = 0
      let release!: () => void
      const both = new Promise<void>((resolve) => {
        release = resolve
      })
      const racing: AdminStore = {
        ...store,
        async withSessionLock(id, work) {
          if (++arrived === 2) release()
          await bounded(both)
          return store.withSessionLock(id, work)
        },
      }
      const results = await Promise.allSettled([
        providerFor(racing).passkeys.verifySignIn(first),
        providerFor(racing).passkeys.verifySignIn(second),
      ])
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
      expect((await store.passkeys.findCredential(key.key.id))?.counter).toBe(1)
      expect(
        (await store.passkeys.findAttempt(digest(first.ceremonyId)))?.consumed_at
      ).toBeInstanceOf(Date)
      expect(
        (await store.passkeys.findAttempt(digest(second.ceremonyId)))?.consumed_at
      ).toBeInstanceOf(Date)
    })

    it('throwing telemetry cannot change outcomes and events expose no ceremony or credential data', async () => {
      const events: NativeSessionEvent[] = []
      const provider = providerFor(store, (event) => {
        events.push(event)
        throw new Error('telemetry failure')
      })
      const options = await provider.passkeys.signInOptions({})
      await expect(
        provider.passkeys.verifySignIn({ ceremonyId: options.ceremonyId, response: {} })
      ).rejects.toThrow()
      expect(events.map((e) => e.type)).toEqual([
        'passkey_attempted',
        'passkey_completed',
        'passkey_attempted',
        'passkey_failed',
      ])
      for (const event of events)
        expect(Object.keys(event).every((key) => ['type', 'purpose', 'reason'].includes(key))).toBe(
          true
        )
      expect(JSON.stringify(events)).not.toContain(options.ceremonyId)
      await providerFor(store, async () => {
        throw new Error('async telemetry failure')
      }).passkeys.signInOptions({})
    })
  })
}
