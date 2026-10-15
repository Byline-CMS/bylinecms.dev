import { createHash, randomBytes } from 'node:crypto'

import type { AdminStore } from '@byline/admin'
import {
  createAuthMaintenanceTasks,
  hashPassword,
  JwtSessionProvider,
  type PasskeyAttemptRow,
} from '@byline/admin/auth'
import type { BylineCore, RecurringTaskContext } from '@byline/core'
import { runDueTasks } from '@byline/core/scheduler'
import { v7 as uuidv7 } from 'uuid'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { bounded } from '../race-barrier.js'
import type { ConformanceHooks } from '../index.js'

const DAY = 86_400_000
const hashToken = () => createHash('sha256').update(randomBytes(32)).digest('hex')
const opaque = () => randomBytes(32).toString('base64url')
const password = 'Maintenance-fixture-password-123!'
export function authMaintenanceSuite(hooks: ConformanceHooks): void {
  const createStore = hooks.createAdminStore
  if (!createStore) return
  const observe = hooks.observePasskeyContention
  const createScheduler = hooks.createSchedulerStore
  if (!observe || !createScheduler)
    throw new Error('Auth maintenance conformance requires connection observation and scheduler')
  describe('auth maintenance', () => {
    let store: AdminStore
    let passwordHash: string
    let now: Date
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    beforeAll(async () => {
      passwordHash = await hashPassword(password)
    })
    beforeEach(async () => {
      await hooks.truncate()
      store = await createStore()
      now = new Date()
    })
    const old = () => new Date(now.getTime() - 31 * DAY)
    const cutoff = () => new Date(now.getTime() - 30 * DAY)
    const future = () => new Date(now.getTime() + DAY)
    const context = (): RecurringTaskContext =>
      ({
        taskName: 'test',
        scheduledFor: now,
        signal: new AbortController().signal,
        heartbeat: vi.fn(async () => {}),
        logger,
      }) as unknown as RecurringTaskContext
    async function account() {
      return store.adminUsers.create({
        email: `${uuidv7()}@example.test`,
        password_hash: passwordHash,
        is_enabled: true,
      })
    }
    async function login(adminUserId: string, expiresAt = future(), revokedAt: Date | null = null) {
      const id = uuidv7()
      await store.withSessionLock(adminUserId, async (scoped) => {
        await scoped.loginSessions.create({
          id,
          admin_user_id: adminUserId,
          session_version: 0,
          expires_at: expiresAt,
        })
        if (revokedAt) await scoped.loginSessions.revoke(id, revokedAt)
      })
      return id
    }
    async function token(adminUserId: string, sid: string | null, expiresAt: Date, scoped = store) {
      return scoped.refreshTokens.issue({
        id: uuidv7(),
        admin_user_id: adminUserId,
        sid,
        token_hash: hashToken(),
        session_version: 0,
        expires_at: expiresAt,
      })
    }
    async function attempt(purpose: PasskeyAttemptRow['purpose'], expiresAt: Date) {
      const user = purpose === 'sign-in' ? null : await account()
      const row: Omit<PasskeyAttemptRow, 'consumed_at'> = {
        token_hash: hashToken(),
        purpose,
        challenge: purpose === 'grant' ? null : opaque(),
        actor_user_id: user?.id ?? null,
        actor_login_id: user ? uuidv7() : null,
        actor_generation: user ? 0 : null,
        action: user ? 'enroll' : null,
        target_user_id: user?.id ?? null,
        credential_record_id: null,
        proof_credential_id: null,
        created_at: new Date(expiresAt.getTime() - 300_000),
        expires_at: expiresAt,
      }
      if (user) await store.withSessionLock(user.id, (scoped) => scoped.passkeys.createAttempt(row))
      else await store.passkeys.createAttempt(row)
      return row
    }
    async function claim(row: Omit<PasskeyAttemptRow, 'consumed_at'>, at: Date) {
      if (row.purpose === 'sign-in')
        return store.passkeys.claimAttempt({
          tokenHash: row.token_hash,
          now: at,
          purpose: 'sign-in',
          binding: { actor_user_id: null, actor_login_id: null, actor_generation: null },
        })
      return store.passkeys.claimAttempt({
        tokenHash: row.token_hash,
        now: at,
        purpose: row.purpose,
        action: 'enroll',
        binding: {
          actor_user_id: row.actor_user_id!,
          actor_login_id: row.actor_login_id!,
          actor_generation: 0,
        },
      })
    }
    it.each(['sign-in', 'fresh-authentication', 'enrollment', 'grant'] as const)(
      'cleans expired %s only after its five-minute grace',
      async (purpose) => {
        const expired = await attempt(purpose, new Date(now.getTime() - 360_000))
        const grace = await attempt(purpose, new Date(now.getTime() - 60_000))
        expect(await claim(grace, now)).toBeNull()
        expect(await store.authMaintenance.purgeAttempts(new Date(now.getTime() - 300_000))).toBe(1)
        expect(await store.passkeys.findAttempt(expired.token_hash)).toBeNull()
        expect(await store.passkeys.findAttempt(grace.token_hash)).not.toBeNull()
      }
    )
    it('cleans consumed rows by consumption grace and never restores replay authority', async () => {
      const aged = await attempt('grant', new Date(now.getTime() - 120_000))
      const recent = await attempt('sign-in', new Date(now.getTime() + 180_000))
      expect(await claim(aged, new Date(now.getTime() - 360_000))).not.toBeNull()
      expect(await claim(recent, new Date(now.getTime() - 60_000))).not.toBeNull()
      expect(await store.authMaintenance.purgeAttempts(new Date(now.getTime() - 300_000))).toBe(1)
      expect(await store.passkeys.findAttempt(aged.token_hash)).toBeNull()
      expect(await store.passkeys.findAttempt(recent.token_hash)).not.toBeNull()
      expect(await claim(recent, now)).toBeNull()
    })
    it('bounds a mixed attempt deletion batch to 100', async () => {
      for (let i = 0; i < 60; i++) await attempt('sign-in', new Date(now.getTime() - 360_000))
      for (let i = 0; i < 45; i++) {
        const consumed = await attempt('sign-in', new Date(now.getTime() - 120_000))
        await claim(consumed, new Date(now.getTime() - 360_000))
      }
      expect(await store.authMaintenance.purgeAttempts(new Date(now.getTime() - 300_000))).toBe(100)
      expect(await store.authMaintenance.purgeAttempts(new Date(now.getTime() - 300_000))).toBe(5)
    })
    it('drains more than 1,000 refresh children in bounded transactions before deleting the parent', async () => {
      const user = await account()
      const id = await login(user.id, future(), old())
      await store.withSessionLock(user.id, async (scoped) => {
        for (let n = 0; n < 1051; n++) await token(user.id, id, future(), scoped)
      })
      for (let batch = 0; batch < 10; batch++) {
        expect(
          await store.withSessionLock(user.id, (scoped) =>
            scoped.authMaintenance.pruneTerminalLogin({
              id,
              adminUserId: user.id,
              before: cutoff(),
            })
          )
        ).toEqual({ refreshDeleted: 100, loginDeleted: false })
        expect(await store.loginSessions.findById(id)).not.toBeNull()
      }
      expect((await store.refreshTokens.listAllForUser(user.id)).length).toBe(51)
      expect(
        await store.withSessionLock(user.id, (scoped) =>
          scoped.authMaintenance.pruneTerminalLogin({ id, adminUserId: user.id, before: cutoff() })
        )
      ).toEqual({ refreshDeleted: 51, loginDeleted: true })
      expect(await store.loginSessions.findById(id)).toBeNull()
      expect(await store.refreshTokens.listAllForUser(user.id)).toEqual([])
    })
    it('returns workRemaining at the batch budget and finishes on a later run', async () => {
      const user = await account()
      for (let i = 0; i < 33; i++) await login(user.id, old())
      const task = createAuthMaintenanceTasks(store, () => now)[1]!
      expect(await task.run(context())).toEqual({ workRemaining: true })
      expect(await store.authMaintenance.findTerminalLogin(cutoff())).not.toBeNull()
      expect(await task.run(context())).toEqual({ workRemaining: false })
      expect(await store.authMaintenance.findTerminalLogin(cutoff())).toBeNull()
    })
    it('requires the account lock and rolls child deletion back with the transaction', async () => {
      const user = await account()
      const id = await login(user.id, old())
      const member = await token(user.id, id, old())
      await expect(
        store.authMaintenance.pruneTerminalLogin({ id, adminUserId: user.id, before: cutoff() })
      ).rejects.toThrow('owning account lock')
      await expect(
        store.withSessionLock(user.id, async (scoped) => {
          await scoped.authMaintenance.pruneTerminalLogin({
            id,
            adminUserId: user.id,
            before: cutoff(),
          })
          throw new Error('rollback')
        })
      ).rejects.toThrow('rollback')
      expect(await store.loginSessions.findById(id)).not.toBeNull()
      expect(await store.refreshTokens.findById(member.id)).not.toBeNull()
    })
    it('preserves live-login predecessors regardless of their expiry or rotation state', async () => {
      const user = await account()
      const id = await login(user.id)
      const predecessor = await token(user.id, id, old())
      const successor = await token(user.id, id, future())
      await store.withSessionLock(user.id, (scoped) =>
        scoped.refreshTokens.markRotated(predecessor.id, successor.id, old())
      )
      for (const task of createAuthMaintenanceTasks(store, () => now)) await task.run(context())
      expect(await store.refreshTokens.purgeExpired(now)).toBe(0)
      expect(await store.refreshTokens.findById(predecessor.id)).not.toBeNull()
      expect(await store.refreshTokens.findById(successor.id)).not.toBeNull()
      expect(await store.loginSessions.findById(id)).not.toBeNull()
      await store.withSessionLock(user.id, (scoped) =>
        scoped.refreshTokens.revokeChain(predecessor.id, now)
      )
      expect((await store.refreshTokens.findById(successor.id))?.revoked_at).not.toBeNull()
    })
    it('preserves logins expired or revoked for less than 30 days', async () => {
      const user = await account()
      const expired = await login(user.id, new Date(now.getTime() - DAY))
      const revoked = await login(user.id, future(), new Date(now.getTime() - DAY))
      expect(await store.authMaintenance.findTerminalLogin(cutoff())).toBeNull()
      for (const id of [expired, revoked])
        expect(
          await store.withSessionLock(user.id, (scoped) =>
            scoped.authMaintenance.pruneTerminalLogin({
              id,
              adminUserId: user.id,
              before: cutoff(),
            })
          )
        ).toEqual({ refreshDeleted: 0, loginDeleted: false })
    })
    it('cleans legacy null-sid rows only 30 days after expiry, in batches of 100', async () => {
      const user = await account()
      for (let i = 0; i < 105; i++) await token(user.id, null, old())
      const recent = await token(user.id, null, new Date(now.getTime() - DAY))
      expect(await store.refreshTokens.purgeExpired(now)).toBe(100)
      expect(await store.authMaintenance.purgeLegacyRefreshTokens(cutoff())).toBe(5)
      expect(await store.refreshTokens.findById(recent.id)).not.toBeNull()
    })
    it('rereads a stale cleanup candidate after an overlapping renewal owns the account lock', async () => {
      const user = await account()
      const id = await login(user.id, old())
      const member = await token(user.id, id, old())
      const candidate = await store.authMaintenance.findTerminalLogin(cutoff())
      expect(candidate?.id).toBe(id)
      const observed = await observe(async (waitForTwoConnections) => {
        let entered!: () => void
        const locked = new Promise<void>((resolve) => {
          entered = resolve
        })
        const renewal = store.withSessionLock(user.id, async (scoped) => {
          entered()
          await bounded(waitForTwoConnections())
          await scoped.loginSessions.extend(id, future())
        })
        await bounded(locked)
        const cleanup = store.withSessionLock(user.id, (scoped) =>
          scoped.authMaintenance.pruneTerminalLogin({ id, adminUserId: user.id, before: cutoff() })
        )
        const [, result] = await Promise.all([renewal, cleanup])
        return result
      })
      expect(observed.maxConcurrentConnections).toBeGreaterThanOrEqual(2)
      expect(observed.result).toEqual({ refreshDeleted: 0, loginDeleted: false })
      expect(await store.refreshTokens.findById(member.id)).not.toBeNull()
      expect((await store.loginSessions.findById(id))?.expires_at.getTime()).toBe(
        future().getTime()
      )
    })
    it('retains revoked credential tombstones and audit entries during every maintenance task', async () => {
      const user = await account()
      const id = uuidv7()
      await store.withSessionLock(user.id, async (scoped) => {
        await scoped.passkeys.createCredential({
          id,
          admin_user_id: user.id,
          credential_id: opaque(),
          public_key: opaque(),
          counter: 0,
          transports: [],
          backup_eligible: false,
          backed_up: false,
          name: 'Old key',
          created_at: old(),
          last_used_at: null,
        })
        await scoped.passkeys.revokeCredential(id, old())
      })
      await store.passkeys.appendRemovalAudit({
        actorId: user.id,
        targetId: user.id,
        credentialId: id,
        outcome: 'denied',
      })
      for (const task of createAuthMaintenanceTasks(store, () => now)) await task.run(context())
      expect((await store.passkeys.findCredential(id))?.revoked_at).not.toBeNull()
      expect(await hooks.readPasskeyAudit!(user.id)).toHaveLength(1)
    })
    it('keeps authorization independent of cleanup outages on password-only sites', async () => {
      const user = await account()
      const provider = new JwtSessionProvider({
        store,
        signingSecret: 'maintenance-secret-with-at-least-32-bytes',
        now: () => now,
      })
      const tokens = await provider.signInWithPassword({ email: user.email, password })
      const broken: AdminStore = {
        ...store,
        authMaintenance: {
          ...store.authMaintenance,
          purgeAttempts: async () => {
            throw new Error('maintenance unavailable')
          },
        },
      }
      await expect(createAuthMaintenanceTasks(broken)[0]!.run(context())).rejects.toThrow(
        'maintenance unavailable'
      )
      await provider.verifyAccessToken(tokens.accessToken)
      await provider.revokeSession({
        accessToken: tokens.accessToken,
        expectedSessionId: tokens.sessionId,
      })
      await expect(provider.verifyAccessToken(tokens.accessToken)).rejects.toThrow()
      const expired = await attempt('sign-in', new Date(now.getTime() - 1))
      expect(await claim(expired, now)).toBeNull()
    })
    it('holds a real scheduler lease through cleanup and records repository failures in health', async () => {
      const scheduler = await createScheduler()
      let enter!: () => void
      let release!: () => void
      const entered = new Promise<void>((resolve) => {
        enter = resolve
      })
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      const failing: AdminStore = {
        ...store,
        authMaintenance: {
          ...store.authMaintenance,
          purgeAttempts: async () => {
            enter()
            await held
            throw new Error('cleanup storage failed')
          },
        },
      }
      const task = createAuthMaintenanceTasks(failing)[0]!
      await scheduler.reconcile([{ name: task.name, intervalMs: 1 }])
      await new Promise((resolve) => setTimeout(resolve, 10))
      const core = { db: { scheduler }, recurringTasks: [task], logger } as unknown as BylineCore
      const pending = runDueTasks(core, { owner: 'maintenance-one', concurrency: 1 })
      await bounded(entered)
      try {
        expect(
          await scheduler.claim({ name: task.name, owner: 'maintenance-two', leaseMs: 60_000 })
        ).toBeNull()
      } finally {
        release()
      }
      expect(await pending).toMatchObject({ claimed: 1, failed: 1 })
      const [health] = await scheduler.health([task.name])
      expect(health).toMatchObject({
        lastStatus: 'failed',
        consecutiveFailures: 1,
        lastError: 'cleanup storage failed',
      })
      expect(health!.nextRunAt.getTime()).toBeGreaterThan(health!.databaseNow.getTime())
    })
  })
}
