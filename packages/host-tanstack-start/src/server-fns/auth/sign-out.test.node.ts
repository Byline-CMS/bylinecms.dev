/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  access: 'access' as string | undefined,
  refresh: 'refresh' as string | undefined,
  revoke: vi.fn(),
  clear: vi.fn(),
  clearPreview: vi.fn(),
}))
vi.mock('@tanstack/react-start', () => ({
  createMiddleware: () => ({ client: () => ({}) }),
  createServerFn: () => ({ middleware: () => ({ handler: (handler: any) => handler }) }),
}))
vi.mock('@byline/core', () => ({
  getServerConfig: () => ({ sessionProvider: { revokeSession: mocks.revoke } }),
}))
vi.mock('@byline/client/server', () => ({
  readAccessTokenCookie: () => mocks.access,
  readRefreshTokenCookie: () => mocks.refresh,
  clearSessionCookies: mocks.clear,
  clearPreviewCookie: mocks.clearPreview,
}))

import { adminSignOut } from './sign-out.js'

const call = adminSignOut as unknown as (args: {
  context: { expectedSessionId?: string }
}) => Promise<unknown>
beforeEach(() => {
  vi.resetAllMocks()
  mocks.access = 'access'
  mocks.refresh = 'refresh'
})

describe('confirmed logout', () => {
  it('revokes with both observed credentials before clearing cookies', async () => {
    mocks.revoke.mockImplementation(async () => {
      expect(mocks.clear).not.toHaveBeenCalled()
    })
    await expect(call({ context: { expectedSessionId: 'A' } })).resolves.toEqual({ status: 'ok' })
    expect(mocks.revoke).toHaveBeenCalledWith({
      accessToken: 'access',
      refreshToken: 'refresh',
      expectedSessionId: 'A',
    })
    expect(mocks.clear).toHaveBeenCalledOnce()
  })
  it('still requests revocation when only the access cookie remains', async () => {
    mocks.refresh = undefined
    await call({ context: { expectedSessionId: 'A' } })
    expect(mocks.revoke).toHaveBeenCalledWith({
      accessToken: 'access',
      refreshToken: undefined,
      expectedSessionId: 'A',
    })
  })
  it('does not clear credentials or report success when revocation fails', async () => {
    mocks.revoke.mockRejectedValue(new Error('database unavailable'))
    await expect(call({ context: { expectedSessionId: 'A' } })).rejects.toThrow(
      'database unavailable'
    )
    expect(mocks.clear).not.toHaveBeenCalled()
    expect(mocks.clearPreview).not.toHaveBeenCalled()
  })
  it('requires the page identity before revoking any observed credential', async () => {
    await expect(call({ context: {} })).rejects.toMatchObject({ code: 'ERR_SESSION_CHANGED' })
    expect(mocks.revoke).not.toHaveBeenCalled()
    expect(mocks.clear).not.toHaveBeenCalled()
  })
  it('is idempotent when neither credential is present', async () => {
    mocks.access = undefined
    mocks.refresh = undefined
    await expect(call({ context: {} })).resolves.toEqual({ status: 'ok' })
    expect(mocks.revoke).not.toHaveBeenCalled()
    expect(mocks.clear).toHaveBeenCalledOnce()
  })
})
