/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ renew: vi.fn() }))
vi.mock('../server-fns/auth/renew.js', () => ({ renewAdminSession: mocks.renew }))

import { acceptSession, expectedSession, sessionIsChanged } from './session-coordination.js'
import { renewExpectedSession } from './session-renewal.js'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('BroadcastChannel', undefined)
  window.sessionStorage.clear()
})

describe('renewExpectedSession', () => {
  // Runs first: the coordinator caches the expected login at module level, so
  // only the initial case in this file observes a page with no expected login.
  it('adopts the verified login when the page had no expected login yet', async () => {
    mocks.renew.mockResolvedValue({ sessionId: 'login-2' })
    await renewExpectedSession()
    expect(mocks.renew).toHaveBeenCalledWith({ data: { expectedSessionId: undefined } })
    expect(expectedSession()).toBe('login-2')
  })

  it('sends the stored expected login and keeps it when renewal returns the same login', async () => {
    acceptSession('login-1')
    mocks.renew.mockResolvedValue({ sessionId: 'login-1' })
    await renewExpectedSession()
    expect(mocks.renew).toHaveBeenCalledWith({ data: { expectedSessionId: 'login-1' } })
    expect(expectedSession()).toBe('login-1')
    expect(sessionIsChanged()).toBe(false)
  })

  it('flags a session change and rethrows when renewal reports one', async () => {
    acceptSession('login-1')
    mocks.renew.mockRejectedValue(
      Object.assign(new Error('changed'), { code: 'ERR_SESSION_CHANGED' })
    )
    await expect(renewExpectedSession()).rejects.toMatchObject({ code: 'ERR_SESSION_CHANGED' })
    expect(sessionIsChanged()).toBe(true)
  })

  it('flags a session change when renewal returns a different login', async () => {
    acceptSession('login-1')
    mocks.renew.mockResolvedValue({ sessionId: 'login-9' })
    await expect(renewExpectedSession()).rejects.toThrow()
    expect(sessionIsChanged()).toBe(true)
  })

  it('coalesces concurrent callers into one renewal request', async () => {
    acceptSession('login-1')
    let release!: () => void
    mocks.renew.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ sessionId: 'login-1' })
      })
    )
    const first = renewExpectedSession()
    const second = renewExpectedSession()
    release()
    await Promise.all([first, second])
    expect(mocks.renew).toHaveBeenCalledTimes(1)
  })
})
