/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPasskeyRequestLimiter } from './passkey-rate-limiter.js'
import { createPasswordSignInLimiter, type SignInRateLimitStore } from './sign-in-rate-limiter.js'

const secret = 'passkey-counter-secret-at-least-thirty-two-bytes'
function fixture() {
  const counts = new Map<string, number>()
  const store: SignInRateLimitStore = {
    consume: vi.fn(async (key, limit) => {
      const n = (counts.get(key) ?? 0) + 1
      counts.set(key, n)
      return n <= limit
    }),
    purgeExpired: vi.fn(async () => 0),
  }
  return { store, limiter: createPasskeyRequestLimiter(store, secret, () => 0) }
}
afterEach(() => vi.useRealTimers())
describe('passkey request limiter', () => {
  it('uses four slots without queueing and retains each slot for 100ms including quick denials', async () => {
    vi.useFakeTimers()
    const { limiter } = fixture()
    const leases = await Promise.all(Array.from({ length: 4 }, () => limiter.acquire()))
    expect(leases.every(Boolean)).toBe(true)
    expect(await limiter.acquire()).toBeNull()
    leases[0]?.()
    leases[0]?.()
    await vi.advanceTimersByTimeAsync(99)
    expect(await limiter.acquire()).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(await limiter.acquire()).toBeTypeOf('function')
    expect(await limiter.acquire()).toBeNull()
  })
  it('shares a 60/minute network bucket across instances with IPv4-mapped equivalence', async () => {
    const { store, limiter } = fixture()
    const another = createPasskeyRequestLimiter(store, secret, () => 0)
    for (let i = 0; i < 60; i++)
      expect((await limiter.consume({ ip: '192.0.2.1' })).allowed).toBe(true)
    expect(await another.consume({ ip: '::ffff:192.0.2.1' })).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    })
    expect((await another.consume({ ip: '192.0.2.2' })).allowed).toBe(true)
    const key = vi.mocked(store.consume).mock.calls[0]?.[0]
    expect(key).toMatch(/^[a-f0-9]{64}$/)
    expect(key).not.toContain('192.0.2.1')
  })
  it('separates the passkey counter domain and capacity from password sign-in', async () => {
    const { store, limiter } = fixture()
    for (let i = 0; i < 4; i++) await limiter.acquire()
    const password = createPasswordSignInLimiter(store, secret, undefined, () => 0, {
      onEvent: () => {},
    })
    const releasePassword = await password.acquire()
    expect(releasePassword).toBeTypeOf('function')
    await limiter.consume({ ip: '192.0.2.1' })
    const passkeyKey = vi.mocked(store.consume).mock.calls.at(-1)?.[0]
    await password.consume({ email: 'admin@example.test', ip: '192.0.2.1' })
    expect(
      vi
        .mocked(store.consume)
        .mock.calls.slice(1)
        .every(([key]) => key !== passkeyKey)
    ).toBe(true)
    releasePassword?.()
    password.dispose()
  })
  it('fails closed on storage errors and rejects invalid addresses', async () => {
    const { store, limiter } = fixture()
    vi.mocked(store.consume).mockRejectedValue(new Error('offline'))
    await expect(limiter.consume({ ip: '192.0.2.1' })).rejects.toThrow('offline')
    await expect(limiter.consume({ ip: 'untrusted' })).rejects.toThrow('Invalid client address')
  })
})
