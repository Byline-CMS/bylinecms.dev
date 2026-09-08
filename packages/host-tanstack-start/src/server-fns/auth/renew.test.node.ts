/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { ERR_ACCESS_EXPIRED, ERR_INVALID_TOKEN, ERR_REVOKED_TOKEN } from '@byline/auth'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  access: 'access' as string | undefined,
  refresh: 'refresh' as string | undefined,
  verify: vi.fn(),
  rotate: vi.fn(),
  cookies: vi.fn(),
}))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    validator: (validate: any) => ({ handler: (handler: any) => ({ validate, handler }) }),
  }),
}))
vi.mock('@tanstack/react-start/server', () => ({ setResponseHeader: vi.fn() }))
vi.mock('@byline/core', () => ({
  getServerConfig: () => ({
    sessionProvider: { verifyAccessToken: mocks.verify, refreshSession: mocks.rotate },
  }),
}))
vi.mock('@byline/client/server', () => ({
  readAccessTokenCookie: () => mocks.access,
  readRefreshTokenCookie: () => mocks.refresh,
  setSessionCookies: mocks.cookies,
}))

import { renewAdminSession } from './renew.js'

const endpoint = renewAdminSession as unknown as { handler: (args: any) => Promise<any> }
const call = () => endpoint.handler({ data: { expectedSessionId: 'A' } })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.access = 'access'
  mocks.refresh = 'refresh'
})
describe('explicit renewal', () => {
  it('does not rotate or write cookies when access is already valid', async () => {
    mocks.verify.mockResolvedValue({ sessionId: 'A' })
    await expect(call()).resolves.toEqual({ sessionId: 'A' })
    expect(mocks.rotate).not.toHaveBeenCalled()
    expect(mocks.cookies).not.toHaveBeenCalled()
  })
  it('passes the original login identity into renewal and writes only confirmed credentials', async () => {
    mocks.verify.mockRejectedValue(ERR_ACCESS_EXPIRED({ message: 'expired' }))
    const tokens = { sessionId: 'A', accessToken: 'new', refreshToken: 'new-refresh' }
    mocks.rotate.mockImplementation(async () => {
      expect(mocks.cookies).not.toHaveBeenCalled()
      return tokens
    })
    await expect(call()).resolves.toEqual({ sessionId: 'A' })
    expect(mocks.rotate).toHaveBeenCalledWith({ refreshToken: 'refresh', expectedSessionId: 'A' })
    expect(mocks.cookies).toHaveBeenCalledWith(tokens)
  })
  it.each([
    ERR_INVALID_TOKEN({ message: 'bad signature' }),
    ERR_REVOKED_TOKEN({ message: 'revoked' }),
    new Error('database'),
  ])('does not turn %s into renewal', async (error) => {
    mocks.verify.mockRejectedValue(error)
    await expect(call()).rejects.toBe(error)
    expect(mocks.rotate).not.toHaveBeenCalled()
    expect(mocks.cookies).not.toHaveBeenCalled()
  })
  it('rejects a different live login instead of accepting the no-op', async () => {
    mocks.verify.mockResolvedValue({ sessionId: 'B' })
    await expect(call()).rejects.toMatchObject({ code: 'ERR_SESSION_CHANGED' })
    expect(mocks.rotate).not.toHaveBeenCalled()
    expect(mocks.cookies).not.toHaveBeenCalled()
  })
  it('preserves the cookie jar on renewal failure', async () => {
    mocks.access = undefined
    mocks.rotate.mockRejectedValue(ERR_REVOKED_TOKEN({ message: 'replayed' }))
    await expect(call()).rejects.toThrow()
    expect(mocks.cookies).not.toHaveBeenCalled()
  })
})
