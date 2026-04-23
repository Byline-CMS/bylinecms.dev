/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Unit coverage for the admin request-context resolver. Mocks the
 * TanStack Start cookie helpers and the `bylineCore.sessionProvider` so
 * the branches can be exercised without a live Postgres or JWT
 * machinery.
 */

import { AdminAuth, AuthError, AuthErrorCodes } from '@byline/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — must be declared before the module under test is imported.
// `vi.mock` is hoisted to the top of the file, so the fakes themselves
// have to go through `vi.hoisted` to be available when the factory runs.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
  refreshSession: vi.fn(),
  getCookie: vi.fn(),
  setCookie: vi.fn(),
  getRequestHeader: vi.fn(),
}))

vi.mock('@byline/core', async () => {
  const actual = await vi.importActual<typeof import('@byline/core')>('@byline/core')
  return {
    ...actual,
    getServerConfig: () => ({
      sessionProvider: {
        verifyAccessToken: mocks.verifyAccessToken,
        refreshSession: mocks.refreshSession,
      },
    }),
  }
})

vi.mock('@tanstack/react-start/server', () => ({
  getCookie: mocks.getCookie,
  setCookie: mocks.setCookie,
  getRequestHeader: mocks.getRequestHeader,
}))

const { verifyAccessToken, refreshSession, getCookie, setCookie } = mocks

// Import AFTER mocks are declared.
import { getAdminRequestContext } from './auth-context.js'

// ---------------------------------------------------------------------------

function cookiesReturn(values: Record<string, string | undefined>) {
  getCookie.mockImplementation((name: string) => values[name])
}

function stubActor() {
  return new AdminAuth({
    id: 'admin-1',
    abilities: ['collections.pages.read'],
  })
}

describe('getAdminRequestContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns the actor directly when the access token verifies', async () => {
    cookiesReturn({
      byline_access_token: 'valid-access',
      byline_refresh_token: 'some-refresh',
    })
    const actor = stubActor()
    verifyAccessToken.mockResolvedValueOnce({ actor })

    const ctx = await getAdminRequestContext()

    expect(ctx.actor).toBe(actor)
    expect(ctx.readMode).toBe('any')
    expect(refreshSession).not.toHaveBeenCalled()
    expect(setCookie).not.toHaveBeenCalled()
  })

  it('refreshes when the access token fails verification', async () => {
    cookiesReturn({
      byline_access_token: 'stale-access',
      byline_refresh_token: 'valid-refresh',
    })
    const actor = stubActor()
    verifyAccessToken.mockRejectedValueOnce(new Error('expired')).mockResolvedValueOnce({ actor })
    refreshSession.mockResolvedValueOnce({
      accessToken: 'fresh-access',
      refreshToken: 'fresh-refresh',
      accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000),
      refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
    })

    const ctx = await getAdminRequestContext()

    expect(ctx.actor).toBe(actor)
    expect(refreshSession).toHaveBeenCalledWith({ refreshToken: 'valid-refresh' })
    // Both access + refresh cookies should have been written with maxAge > 0.
    expect(setCookie).toHaveBeenCalledTimes(2)
    const accessCall = setCookie.mock.calls.find((c) => c[0] === 'byline_access_token')
    expect(accessCall?.[1]).toBe('fresh-access')
    expect(accessCall?.[2]?.maxAge).toBeGreaterThan(0)
  })

  it('refreshes when the access cookie is missing but a refresh cookie exists', async () => {
    cookiesReturn({ byline_refresh_token: 'only-refresh' })
    const actor = stubActor()
    refreshSession.mockResolvedValueOnce({
      accessToken: 'fresh-access',
      refreshToken: 'fresh-refresh',
      accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000),
      refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
    })
    verifyAccessToken.mockResolvedValueOnce({ actor })

    const ctx = await getAdminRequestContext()

    expect(ctx.actor).toBe(actor)
    // The access-token path was skipped (no cookie) so verifyAccessToken ran
    // only for the freshly-issued token.
    expect(verifyAccessToken).toHaveBeenCalledTimes(1)
    expect(verifyAccessToken).toHaveBeenCalledWith('fresh-access')
  })

  it('throws ERR_UNAUTHENTICATED and clears cookies when no session exists', async () => {
    cookiesReturn({})

    try {
      await getAdminRequestContext()
      expect.fail('expected ERR_UNAUTHENTICATED')
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError)
      expect((err as AuthError).code).toBe(AuthErrorCodes.UNAUTHENTICATED)
    }
    // Cookie clear = setCookie with empty value and maxAge 0 for both names.
    const clears = setCookie.mock.calls.filter((c) => c[2]?.maxAge === 0)
    const clearedNames = new Set(clears.map((c) => c[0]))
    expect(clearedNames.has('byline_access_token')).toBe(true)
    expect(clearedNames.has('byline_refresh_token')).toBe(true)
  })

  it('clears cookies and throws when refresh itself fails', async () => {
    cookiesReturn({
      byline_access_token: 'stale',
      byline_refresh_token: 'bad-refresh',
    })
    verifyAccessToken.mockRejectedValueOnce(new Error('expired'))
    refreshSession.mockRejectedValueOnce(new Error('revoked'))

    try {
      await getAdminRequestContext()
      expect.fail('expected ERR_UNAUTHENTICATED')
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError)
      expect((err as AuthError).code).toBe(AuthErrorCodes.UNAUTHENTICATED)
    }
    const clears = setCookie.mock.calls.filter((c) => c[2]?.maxAge === 0)
    expect(clears.length).toBe(2)
  })

  it('clears cookies and throws when the refreshed access token fails to verify', async () => {
    cookiesReturn({
      byline_access_token: 'stale',
      byline_refresh_token: 'valid',
    })
    verifyAccessToken
      .mockRejectedValueOnce(new Error('expired'))
      .mockRejectedValueOnce(new Error('still bad'))
    refreshSession.mockResolvedValueOnce({
      accessToken: 'fresh-but-somehow-bad',
      refreshToken: 'fresh-refresh',
      accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000),
      refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
    })

    try {
      await getAdminRequestContext()
      expect.fail('expected ERR_UNAUTHENTICATED')
    } catch (err) {
      expect((err as AuthError).code).toBe(AuthErrorCodes.UNAUTHENTICATED)
    }
    const clears = setCookie.mock.calls.filter((c) => c[2]?.maxAge === 0)
    expect(clears.length).toBe(2)
  })
})
