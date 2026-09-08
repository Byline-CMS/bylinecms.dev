/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createPasswordSignInLimiter,
  type SignInRateLimitStore,
} from '../src/modules/auth/sign-in-rate-limiter.js'

function store(): SignInRateLimitStore {
  const counters = new Map<string, number>()
  return {
    consume: vi.fn(async (key, limit) => {
      const count = (counters.get(key) ?? 0) + 1
      counters.set(key, count)
      return count <= limit
    }),
    purgeExpired: vi.fn(async () => 0),
  }
}
const secret = 'test-secret-'.repeat(4)
const policy = {
  account: { limit: 2, windowSeconds: 60 },
  ip: { limit: 3, windowSeconds: 60 },
}
const limiters: ReturnType<typeof createPasswordSignInLimiter>[] = []
function create(db = store(), time = () => 1000, options = {}) {
  const limiter = createPasswordSignInLimiter(db, secret, policy, time, {
    onEvent: vi.fn(),
    ...options,
  })
  limiters.push(limiter)
  return limiter
}
afterEach(() => {
  for (const limiter of limiters.splice(0)) limiter.dispose()
  vi.useRealTimers()
})

describe('password sign-in admission', () => {
  it('shares normalized account/network limits across instances without locking out other networks', async () => {
    const db = store()
    const a = create(db)
    const b = create(db)
    expect((await a.consume({ email: 'Admin@Example.com', ip: '192.0.2.1' })).allowed).toBe(true)
    expect((await b.consume({ email: ' admin@example.com ', ip: '192.0.2.1' })).allowed).toBe(true)
    expect(await b.consume({ email: 'admin@example.com', ip: '192.0.2.1' })).toEqual({
      allowed: false,
      retryAfterSeconds: 59,
    })
    expect((await b.consume({ email: 'admin@example.com', ip: '192.0.2.2' })).allowed).toBe(true)
    for (const [key] of vi.mocked(db.consume).mock.calls) expect(key).toMatch(/^[a-f0-9]{64}$/)
  })
  it('groups IPv6 /64s and mapped IPv4 consistently', async () => {
    const limiter = create()
    for (const ip of ['2001:db8:1:2::1', '2001:db8:1:2:ffff::2'])
      expect((await limiter.consume({ email: 'a', ip })).allowed).toBe(true)
    expect((await limiter.consume({ email: 'a', ip: '2001:db8:1:2::3' })).allowed).toBe(false)
    expect((await limiter.consume({ email: 'a', ip: '2001:db8:1:3::3' })).allowed).toBe(true)
    for (const ip of ['192.0.2.1', '::ffff:192.0.2.1'])
      expect((await limiter.consume({ email: 'a', ip })).allowed).toBe(true)
    expect((await limiter.consume({ email: 'a', ip: '::ffff:c000:201' })).allowed).toBe(false)
  })
  it('limits spraying before allocating account counters and has no installation lockout', async () => {
    const db = store()
    const limiter = create(db)
    for (let i = 0; i < 3; i++)
      expect((await limiter.consume({ email: String(i), ip: '192.0.2.1' })).allowed).toBe(true)
    expect((await limiter.consume({ email: 'fourth', ip: '192.0.2.1' })).allowed).toBe(false)
    expect(db.consume).toHaveBeenCalledTimes(7)
    for (let i = 2; i < 200; i++)
      expect((await limiter.consume({ email: 'a', ip: `192.0.2.${i}` })).allowed).toBe(true)
  })
  it('admits again in a new window and reports cross-network account correlation without raw identities', async () => {
    let time = 1000
    const events: unknown[] = []
    const limiter = create(store(), () => time, { onEvent: (e: unknown) => events.push(e) })
    for (let i = 0; i < 2; i++) await limiter.consume({ email: 'a', ip: '192.0.2.1' })
    expect((await limiter.consume({ email: 'a', ip: '192.0.2.1' })).allowed).toBe(false)
    time = 60_000
    expect((await limiter.consume({ email: 'a', ip: '192.0.2.2' })).allowed).toBe(true)
    limiter.recordResult?.({ email: 'a', ip: '192.0.2.2' }, 'failure')
    expect(events[2]).toMatchObject({ type: 'denied', scope: 'account' })
    expect(events[4]).toMatchObject({ type: 'failure', account: (events[0] as any).account })
    expect(JSON.stringify(events)).not.toContain('192.0.2.')
  })
  it('propagates store failures and isolates failing telemetry', async () => {
    const db = store()
    vi.mocked(db.consume).mockRejectedValue(new Error('offline'))
    await expect(
      create(db, () => 1000, {
        onEvent: () => {
          throw new Error('telemetry')
        },
      }).consume({ email: 'x', ip: '192.0.2.1' })
    ).rejects.toThrow('offline')
  })
  it('bounds the queue, times out waiters, and keeps fast releases occupied for the creation budget', async () => {
    vi.useFakeTimers()
    const limiter = create(store(), Date.now, {
      maxQueue: 1,
      minimumSlotMs: 100,
      queueTimeoutMs: 50,
    })
    const release = await limiter.acquire()
    expect(release).not.toBeNull()
    const waiting = limiter.acquire()
    expect(await limiter.acquire()).toBeNull()
    release?.()
    release?.()
    await vi.advanceTimersByTimeAsync(50)
    expect(await waiting).toBeNull()
    await vi.advanceTimersByTimeAsync(50)
    expect(await limiter.acquire()).not.toBeNull()
  })
  it('hands released capacity to a queued request', async () => {
    vi.useFakeTimers()
    const limiter = create()
    const release = await limiter.acquire()
    const waiting = limiter.acquire()
    release?.()
    await vi.advanceTimersByTimeAsync(100)
    const next = await waiting
    expect(next).not.toBeNull()
    next?.()
  })
  it('is inert until requests or the scheduler run, and drains idle residue in bounded batches', async () => {
    vi.useFakeTimers()
    const db = store()
    const limiter = create(db)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(db.purgeExpired).not.toHaveBeenCalled()
    const context = {
      signal: new AbortController().signal,
      heartbeat: vi.fn(async () => {}),
    } as any
    vi.mocked(db.purgeExpired)
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(100)
      .mockResolvedValue(0)
    expect(await limiter.cleanupTask.run(context)).toEqual({ workRemaining: false })
    expect(db.purgeExpired).toHaveBeenCalledTimes(3)
    expect(context.heartbeat).toHaveBeenCalledTimes(3)
    expect(limiter.requiredCleanupTask).toBe(limiter.cleanupTask.name)
    vi.mocked(db.purgeExpired).mockClear().mockResolvedValue(100)
    expect(await limiter.cleanupTask.run(context)).toEqual({ workRemaining: true })
    expect(db.purgeExpired).toHaveBeenCalledTimes(32)
  })
  it('stops cleanup on lease loss and propagates store failures to scheduler health', async () => {
    const db = store()
    const limiter = create(db)
    const context = {
      signal: new AbortController().signal,
      heartbeat: vi.fn(async () => {}),
    } as any
    context.heartbeat.mockRejectedValueOnce(new Error('lease lost'))
    await expect(limiter.cleanupTask.run(context)).rejects.toThrow('lease lost')
    expect(db.purgeExpired).not.toHaveBeenCalled()
    vi.mocked(db.purgeExpired).mockRejectedValueOnce(new Error('offline'))
    await expect(limiter.cleanupTask.run(context)).rejects.toThrow('offline')
    const abort = new AbortController()
    abort.abort(new Error('shutdown'))
    await expect(limiter.cleanupTask.run({ ...context, signal: abort.signal })).rejects.toThrow(
      'shutdown'
    )
  })
  it('shares HMAC keys only within an installation and validates secret length', async () => {
    const a = store(),
      b = store(),
      c = store()
    const input = { email: 'admin@example.com', ip: '192.0.2.1' }
    const eventsA = vi.fn(),
      eventsB = vi.fn(),
      eventsC = vi.fn()
    await create(a, () => 1000, { onEvent: eventsA }).consume(input)
    await create(b, () => 1000, { onEvent: eventsB }).consume(input)
    const other = createPasswordSignInLimiter(c, 'different-secret'.repeat(3), policy, () => 1000, {
      onEvent: eventsC,
    })
    limiters.push(other)
    await other.consume(input)
    expect(vi.mocked(a.consume).mock.calls.map(([key]) => key)).toEqual(
      vi.mocked(b.consume).mock.calls.map(([key]) => key)
    )
    expect(vi.mocked(a.consume).mock.calls.map(([key]) => key)).not.toEqual(
      vi.mocked(c.consume).mock.calls.map(([key]) => key)
    )
    expect(eventsA.mock.calls[0][0]).toEqual(eventsB.mock.calls[0][0])
    expect(eventsA.mock.calls[0][0].account).not.toBe(eventsC.mock.calls[0][0].account)
    expect(eventsA.mock.calls[0][0].network).not.toBe(eventsC.mock.calls[0][0].network)
    expect(() => createPasswordSignInLimiter(store(), 'short')).toThrow(/32 bytes/)
  })
})
