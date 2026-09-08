/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  vi.unstubAllGlobals()
})
function browserStorage() {
  const values = new Map<string, string>()
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
    },
  })
  return values
}
describe('browser session coordination', () => {
  it('six concurrent renewals share one operation and a later request can renew again', async () => {
    const { renewSingleFlight } = await import('./session-coordination.js')
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const work = vi.fn(() => pending)
    const calls = Array.from({ length: 6 }, () => renewSingleFlight(work))
    expect(work).toHaveBeenCalledOnce()
    release()
    await Promise.all(calls)
    await renewSingleFlight(work)
    expect(work).toHaveBeenCalledTimes(2)
  })
  it('rejects work captured before session change even after acknowledgement', async () => {
    browserStorage()
    const state = await import('./session-coordination.js')
    state.acceptSession('A')
    const old = state.sessionSnapshot()
    expect(() => state.observeSession('B')).toThrow('Session changed')
    expect(() => state.requireUnchanged(old)).toThrow()
    state.acceptSession('B')
    expect(() => state.requireUnchanged(old)).toThrow()
    expect(() => state.requireUnchanged(state.sessionSnapshot())).not.toThrow()
  })
  it('retains successful sign-in intent across navigation and detects a different server login', async () => {
    const values = browserStorage()
    const before = await import('./session-coordination.js')
    before.acceptSession('B')
    vi.resetModules()
    const after = await import('./session-coordination.js')
    expect(after.expectedSession()).toBe('B')
    expect(() => after.observeSession('A')).toThrow()
    expect(values.get('byline.expected-login')).toBe('B')
  })
  it('serializes auth writes and releases the queue after failure without Web Locks', async () => {
    vi.stubGlobal('navigator', {})
    const { coordinateAuthAction } = await import('./session-coordination.js')
    const order: number[] = []
    const a = coordinateAuthAction(async () => {
      order.push(1)
      throw new Error('failed')
    })
    const b = coordinateAuthAction(async () => {
      order.push(2)
      return 'ok'
    })
    await expect(a).rejects.toThrow()
    await expect(b).resolves.toBe('ok')
    expect(order).toEqual([1, 2])
  })
})
