/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { ERR_ACCESS_EXPIRED, ERR_REVOKED_TOKEN } from '@byline/auth'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  request: {},
  headers: new Map<string, string>(),
  auth: vi.fn(),
  renew: vi.fn(),
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () => mocks.request,
  setResponseHeader: (k: string, v: string) => mocks.headers.set(k, v),
}))
vi.mock('@byline/client/server', () => ({ getAdminRequestContext: mocks.auth }))
vi.mock('../server-fns/auth/renew.js', () => ({ renewAdminSession: mocks.renew }))

import { adminSessionMiddleware } from './session-middleware.js'
import { recordSessionRequestKind } from './session-request-kind.js'

const server = adminSessionMiddleware.options.server!
const invoke = (next: any, expected: unknown = 'login-A', method = 'POST') =>
  server({ next, context: { bylineExpectedSessionId: expected }, method } as any)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.headers.clear()
  recordSessionRequestKind(mocks.request, 'serverFn')
  mocks.auth.mockResolvedValue({ sessionId: 'login-A', actor: { id: 'account-X' } })
})
describe('pre-handler session boundary', () => {
  it.each([null, undefined, '', 'login-B'])(
    'rejects missing or changed expected sid %s before any side effect',
    async (expected) => {
      const write = vi.fn()
      // Explicit undefined must not invoke the helper default.
      await expect(
        server({
          next: write,
          context: { bylineExpectedSessionId: expected },
          method: 'POST',
        } as any)
      ).rejects.toMatchObject({ code: 'ERR_SESSION_CHANGED' })
      expect(write).not.toHaveBeenCalled()
      expect(mocks.headers.get('x-byline-auth-boundary')).toBe('changed')
    }
  )
  it('signals renewal only for expiry before the handler starts', async () => {
    const write = vi.fn()
    mocks.auth.mockRejectedValue(ERR_ACCESS_EXPIRED({ message: 'expired' }))
    await expect(invoke(write)).rejects.toThrow()
    expect(write).not.toHaveBeenCalled()
    expect(mocks.headers.get('x-byline-auth-boundary')).toBe('renew')
  })
  it('does not renew revoked credentials or database errors', async () => {
    for (const error of [ERR_REVOKED_TOKEN({ message: 'revoked' }), new Error('db unavailable')]) {
      const write = vi.fn()
      mocks.auth.mockRejectedValue(error)
      await expect(invoke(write)).rejects.toThrow()
      expect(write).not.toHaveBeenCalled()
      expect(mocks.headers.has('x-byline-auth-boundary')).toBe(false)
    }
  })
  it('never turns an expiry error thrown after a side effect into a retry signal', async () => {
    const write = vi.fn(async () => {
      mocks.headers.set('x-byline-auth-boundary', 'renew')
      throw ERR_ACCESS_EXPIRED({ message: 'handler error' })
    })
    await expect(invoke(write)).rejects.toThrow()
    expect(write).toHaveBeenCalledOnce()
    expect(mocks.headers.get('x-byline-auth-boundary')).toBe('handled')
  })
  it('allows server-classified SSR reads, but not SSR mutations without expected sid', async () => {
    recordSessionRequestKind(mocks.request, 'router')
    const read = vi.fn(async () => ({}))
    await invoke(read, null, 'GET')
    expect(read).toHaveBeenCalledOnce()
    await expect(invoke(read, null)).rejects.toMatchObject({ code: 'ERR_SESSION_CHANGED' })
    expect(read).toHaveBeenCalledOnce()
  })
})
