/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createHash, randomBytes } from 'node:crypto'

import type { AdminStore } from '@byline/admin'
import type { PasskeyAttemptRow, PasskeyClaimInput, PasskeyCredentialRow } from '@byline/admin/auth'
import { v7 as uuidv7 } from 'uuid'
import { beforeAll, describe, expect, it } from 'vitest'

import { bounded } from '../race-barrier.js'
import type { ConformanceHooks } from '../index.js'

const opaque = () => randomBytes(32).toString('base64url')
const tokenHash = () => createHash('sha256').update(randomBytes(32)).digest('hex')
const anonymous = { actor_user_id: null, actor_login_id: null, actor_generation: null } as const

export function passkeysPersistenceSuite(hooks: ConformanceHooks): void {
  const createStore = hooks.createAdminStore
  if (!createStore) return
  const observe = hooks.observePasskeyContention
  if (!observe) throw new Error('Passkey conformance requires physical-connection observation')

  describe('passkey persistence', () => {
    let store: AdminStore
    beforeAll(async () => {
      await hooks.truncate()
      store = await createStore()
    })

    async function account() {
      return store.adminUsers.create({
        email: `${uuidv7()}@example.test`,
        password_hash: 'fixture',
        is_enabled: true,
      })
    }
    function attempt(
      patch: Partial<PasskeyAttemptRow> = {}
    ): Omit<PasskeyAttemptRow, 'consumed_at'> {
      const now = new Date()
      return {
        token_hash: tokenHash(),
        purpose: 'sign-in',
        challenge: opaque(),
        ...anonymous,
        action: null,
        target_user_id: null,
        credential_record_id: null,
        proof_credential_id: null,
        created_at: now,
        expires_at: new Date(now.getTime() + 300_000),
        ...patch,
      }
    }
    function credential(
      userId: string,
      credentialId = opaque()
    ): Omit<PasskeyCredentialRow, 'revoked_at'> & { admin_user_id: string } {
      return {
        id: uuidv7(),
        admin_user_id: userId,
        credential_id: credentialId,
        public_key: opaque(),
        counter: 0,
        transports: ['internal', 'hybrid'],
        backup_eligible: true,
        backed_up: true,
        name: 'Device',
        created_at: new Date(),
        last_used_at: null,
      }
    }
    async function insertCredential(userId: string, credentialId?: string) {
      const row = credential(userId, credentialId)
      await store.withSessionLock(userId, (scoped) => scoped.passkeys.createCredential(row))
      return row
    }

    it('commits one winner under overlapping physical connections', async () => {
      const row = attempt()
      await store.passkeys.createAttempt(row)
      const { result, maxConcurrentConnections } = await observe(async () =>
        Promise.all(
          Array.from({ length: 8 }, () =>
            store.passkeys.claimAttempt({
              tokenHash: row.token_hash,
              purpose: 'sign-in',
              binding: anonymous,
              now: new Date(),
            })
          )
        )
      )
      expect(maxConcurrentConnections).toBeGreaterThanOrEqual(2)
      expect(result.filter(Boolean)).toHaveLength(1)
      expect((await store.passkeys.findAttempt(row.token_hash))?.consumed_at).toBeInstanceOf(Date)
    })

    it('checks purpose, expiry and every authenticated binding before consumption', async () => {
      const actor = await account()
      const binding = { actor_user_id: actor.id, actor_login_id: uuidv7(), actor_generation: 3 }
      const row = attempt({
        ...binding,
        purpose: 'grant',
        challenge: null,
        action: 'remove',
        target_user_id: uuidv7(),
        credential_record_id: uuidv7(),
        proof_credential_id: uuidv7(),
      })
      await store.withSessionLock(actor.id, (scoped) => scoped.passkeys.createAttempt(row))
      const claim = {
        tokenHash: row.token_hash,
        purpose: 'grant' as const,
        binding,
        action: 'remove' as const,
        now: new Date(),
      }
      for (const override of [
        { purpose: 'enrollment' as const },
        { action: 'enroll' as const },
        { binding: { ...binding, actor_user_id: uuidv7() } },
        { binding: { ...binding, actor_login_id: uuidv7() } },
        { binding: { ...binding, actor_generation: 4 } },
        { now: row.expires_at },
      ])
        expect(await store.passkeys.claimAttempt({ ...claim, ...override })).toBeNull()
      await expect(
        store.passkeys.claimAttempt({
          ...claim,
          binding: anonymous,
        } as unknown as PasskeyClaimInput)
      ).rejects.toThrow('binding')
      expect((await store.passkeys.findAttempt(row.token_hash))?.consumed_at).toBeNull()
      expect(await store.passkeys.claimAttempt(claim)).toMatchObject({
        target_user_id: row.target_user_id,
        credential_record_id: row.credential_record_id,
        proof_credential_id: row.proof_credential_id,
      })
      expect(await store.passkeys.claimAttempt(claim)).toBeNull()
    })

    it.each(['enroll', 'remove'] as const)(
      'requires the explicit action when claiming a %s grant',
      async (action) => {
        const actor = await account()
        const binding = { actor_user_id: actor.id, actor_login_id: uuidv7(), actor_generation: 0 }
        const row = attempt({
          ...binding,
          purpose: 'grant',
          challenge: null,
          action,
          target_user_id: actor.id,
          credential_record_id: action === 'remove' ? uuidv7() : null,
        })
        await store.withSessionLock(actor.id, (scoped) => scoped.passkeys.createAttempt(row))
        // @ts-expect-error Authenticated claim inputs must include an explicit action.
        const missingAction: PasskeyClaimInput = {
          tokenHash: row.token_hash,
          purpose: 'grant',
          binding,
          now: new Date(),
        }
        await expect(store.passkeys.claimAttempt(missingAction)).rejects.toThrow('action')
        const claim = {
          tokenHash: row.token_hash,
          purpose: 'grant' as const,
          binding,
          action,
          now: new Date(),
        }
        expect(
          await store.passkeys.claimAttempt({
            ...claim,
            action: action === 'enroll' ? 'remove' : 'enroll',
          })
        ).toBeNull()
        expect((await store.passkeys.findAttempt(row.token_hash))?.consumed_at).toBeNull()
        expect(await store.passkeys.claimAttempt(claim)).not.toBeNull()
      }
    )

    it('keeps consumption committed when the later account transaction rolls back', async () => {
      const actor = await account()
      const row = attempt()
      await store.passkeys.createAttempt(row)
      const claim = {
        tokenHash: row.token_hash,
        purpose: 'sign-in' as const,
        binding: anonymous,
        now: new Date(),
      }
      expect(await store.passkeys.claimAttempt(claim)).not.toBeNull()
      const key = credential(actor.id)
      await expect(
        store.withSessionLock(actor.id, async (scoped) => {
          await scoped.passkeys.createCredential(key)
          throw new Error('verification/business failure')
        })
      ).rejects.toThrow('verification/business failure')
      expect(await store.passkeys.findCredential(key.id)).toBeNull()
      expect(await store.passkeys.claimAttempt(claim)).toBeNull()
    })

    it('rejects consumption inside an account transaction instead of rolling it back with a savepoint', async () => {
      const actor = await account()
      const row = attempt()
      await store.passkeys.createAttempt(row)
      const claim = {
        tokenHash: row.token_hash,
        purpose: 'sign-in' as const,
        binding: anonymous,
        now: new Date(),
      }
      await expect(
        store.withSessionLock(actor.id, (scoped) => scoped.passkeys.claimAttempt(claim))
      ).rejects.toThrow('root store')
      expect(await store.passkeys.claimAttempt(claim)).not.toBeNull()
    })

    it('allocates one stable handle during concurrent first enrollment and keeps it private', async () => {
      const actor = await account()
      const first = opaque()
      const second = opaque()
      const { result, maxConcurrentConnections } = await observe(async (waitForTwo) => {
        const a = store.withSessionLock(actor.id, async (scoped) => {
          await bounded(waitForTwo())
          return scoped.passkeys.ensureUserHandle(actor.id, first)
        })
        const b = store.withSessionLock(actor.id, (scoped) =>
          scoped.passkeys.ensureUserHandle(actor.id, second)
        )
        return Promise.all([a, b])
      })
      expect(maxConcurrentConnections).toBeGreaterThanOrEqual(2)
      expect(result[0]).toBe(result[1])
      expect([first, second]).toContain(result[0])
      expect(await store.passkeys.getUserHandle(actor.id)).toBe(result[0])
      expect(await store.adminUsers.getById(actor.id)).not.toHaveProperty('webauthn_user_handle')
      expect(await store.adminUsers.getByIdForSignIn(actor.id)).not.toHaveProperty(
        'webauthn_user_handle'
      )
      const key = await insertCredential(actor.id)
      await store.withSessionLock(actor.id, (scoped) =>
        scoped.passkeys.revokeCredential(key.id, new Date())
      )
      expect(
        await store.withSessionLock(actor.id, (scoped) =>
          scoped.passkeys.ensureUserHandle(actor.id, opaque())
        )
      ).toBe(result[0])
    })

    it('preserves byte-exact identity and tombstones through revocation and account deletion', async () => {
      const actor = await account()
      const other = await account()
      const upper = await insertCredential(actor.id, 'AQ')
      const lower = await insertCredential(other.id, 'aQ')
      expect((await store.passkeys.findCredentialByCredentialId('AQ'))?.id).toBe(upper.id)
      expect((await store.passkeys.findCredentialByCredentialId('aQ'))?.id).toBe(lower.id)
      await store.withSessionLock(actor.id, (scoped) =>
        scoped.passkeys.revokeCredential(upper.id, new Date())
      )
      expect(await store.passkeys.listCredentials(actor.id)).toEqual([])
      await expect(insertCredential(other.id, 'AQ')).rejects.toThrow()
      await store.adminUsers.delete(actor.id, actor.vid)
      expect(await store.passkeys.findCredential(upper.id)).toMatchObject({
        admin_user_id: null,
        credential_id: 'AQ',
      })
      await expect(insertCredential(other.id, 'AQ')).rejects.toThrow()
      await expect(insertCredential(other.id, 'AQ==')).rejects.toThrow('encoding')
      await expect(insertCredential(other.id, 'AR')).rejects.toThrow('encoding')
    })

    it('round-trips unsigned WebAuthn counters and keeps updates in the account transaction', async () => {
      const actor = await account()
      const key = await insertCredential(actor.id)
      const usedAt = new Date()
      await store.withSessionLock(actor.id, (scoped) =>
        scoped.passkeys.updateCredential(key.id, {
          counter: 4294967295,
          name: 'Renamed',
          backed_up: false,
          last_used_at: usedAt,
        })
      )
      expect(await store.passkeys.findCredential(key.id)).toMatchObject({
        counter: 4294967295,
        name: 'Renamed',
        backed_up: false,
        last_used_at: usedAt,
      })
      await expect(
        store.withSessionLock(actor.id, async (scoped) => {
          await scoped.passkeys.updateCredential(key.id, { counter: 1 })
          throw new Error('rollback')
        })
      ).rejects.toThrow('rollback')
      expect((await store.passkeys.findCredential(key.id))?.counter).toBe(4294967295)
    })

    it('requires the correct account lock for credential and management writes', async () => {
      const actor = await account()
      const other = await account()
      const key = credential(actor.id)
      await expect(store.passkeys.createCredential(key)).rejects.toThrow('account lock')
      await expect(
        store.withSessionLock(other.id, (scoped) => scoped.passkeys.createCredential(key))
      ).rejects.toThrow('account lock')
      await expect(store.passkeys.ensureUserHandle(actor.id, opaque())).rejects.toThrow(
        'account lock'
      )
      const row = attempt({
        purpose: 'enrollment',
        actor_user_id: actor.id,
        actor_login_id: uuidv7(),
        actor_generation: 0,
        action: 'enroll',
        target_user_id: actor.id,
      })
      await expect(store.passkeys.createAttempt(row)).rejects.toThrow('account lock')
      await store.withSessionLock(actor.id, (scoped) => scoped.passkeys.createAttempt(row))
    })

    it('counts all pending authenticated purposes together and excludes consumed or expired records', async () => {
      const actor = await account()
      const login = uuidv7()
      const now = new Date()
      const binding = { actor_user_id: actor.id, actor_login_id: login, actor_generation: 0 }
      const rows = ['fresh-authentication', 'enrollment', 'grant'].map((purpose) =>
        attempt({
          ...binding,
          purpose: purpose as PasskeyAttemptRow['purpose'],
          challenge: purpose === 'grant' ? null : opaque(),
          action: 'enroll',
          target_user_id: actor.id,
        })
      )
      await store.withSessionLock(actor.id, async (scoped) => {
        for (const row of rows) await scoped.passkeys.createAttempt(row)
      })
      expect(await store.passkeys.countPendingForLogin(login, now)).toBe(3)
      await store.passkeys.claimAttempt({
        tokenHash: rows[0]!.token_hash,
        purpose: 'fresh-authentication',
        action: 'enroll',
        binding,
        now,
      })
      expect(await store.passkeys.countPendingForLogin(login, now)).toBe(2)
      expect(
        await store.passkeys.countPendingForLogin(
          login,
          new Date(Math.max(...rows.map((row) => row.expires_at.getTime())))
        )
      ).toBe(0)
    })

    it('rejects malformed storage authority and lifetime extensions', async () => {
      await expect(store.passkeys.createAttempt(attempt({ token_hash: opaque() }))).rejects.toThrow(
        'hash'
      )
      await expect(
        store.passkeys.createAttempt(attempt({ actor_user_id: uuidv7() }))
      ).rejects.toThrow('management authority')
      const row = attempt()
      await expect(
        store.passkeys.createAttempt({
          ...row,
          expires_at: new Date(row.created_at.getTime() + 300_001),
        })
      ).rejects.toThrow('lifetime')
      await expect(
        store.passkeys.createAttempt({ ...row, expires_at: row.created_at })
      ).rejects.toThrow('lifetime')
    })
  })
}
