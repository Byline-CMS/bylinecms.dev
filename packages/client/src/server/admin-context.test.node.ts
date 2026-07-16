/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Unit coverage for the admin request-context resolver. Registers a fake
 * `HostRequestBridge` and mocks the config's `sessionProvider` so the
 * branches can be exercised without a live Postgres or JWT machinery.
 */

import { AdminAuth, AuthError, AuthErrorCodes } from '@byline/auth'
import { registerHostRequestBridge } from '@byline/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
  refreshSession: vi.fn(),
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

import { getAdminRequestContext } from './admin-context.js'

const BRIDGE_SLOT = Symbol.for('__byline_host_request_bridge__')
const previousBridge = (globalThis as Record<PropertyKey, unknown>)[BRIDGE_SLOT]

const bridge = {
  getRequest: vi.fn<() => object | undefined>(),
  getCookie: vi.fn<(name: string) => string | undefined>(),
  setCookie: vi.fn(),
}

const { verifyAccessToken, refreshSession } = mocks
const { getCookie, setCookie } = bridge

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
    registerHostRequestBridge(bridge)
    // Default: no request in scope, so every call resolves fresh. The
    // per-request memoization tests below override this with a stable
    // request object.
    bridge.getRequest.mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
    ;(globalThis as Record<PropertyKey, unknown>)[BRIDGE_SLOT] = previousBridge
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

  it('throws ERR_UNAUTHENTICATED without emitting Set-Cookie when no cookies are sent', async () => {
    cookiesReturn({})

    try {
      await getAdminRequestContext()
      expect.fail('expected ERR_UNAUTHENTICATED')
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError)
      expect((err as AuthError).code).toBe(AuthErrorCodes.UNAUTHENTICATED)
    }
    // Anonymous visitors must produce zero Set-Cookie headers so shared
    // caches (Cloudflare) can cache public pages — a Set-Cookie on the
    // response is a hard bypass signal for CDNs.
    expect(setCookie).not.toHaveBeenCalled()
  })

  it('clears the stale access cookie when only an access token was sent', async () => {
    cookiesReturn({ byline_access_token: 'stale' })
    verifyAccessToken.mockRejectedValueOnce(new Error('expired'))

    try {
      await getAdminRequestContext()
      expect.fail('expected ERR_UNAUTHENTICATED')
    } catch (err) {
      expect((err as AuthError).code).toBe(AuthErrorCodes.UNAUTHENTICATED)
    }
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

  describe('per-request memoization', () => {
    it('returns the same context instance — and requestId — for every call in one request', async () => {
      bridge.getRequest.mockReturnValue({ id: 'request-a' })
      cookiesReturn({
        byline_access_token: 'valid-access',
        byline_refresh_token: 'some-refresh',
      })
      verifyAccessToken.mockResolvedValue({ actor: stubActor() })

      const first = await getAdminRequestContext()
      const second = await getAdminRequestContext()

      // Reads sharing a ReadContext bind one request authority; the token
      // includes requestId, so it must be stable within a request.
      expect(second).toBe(first)
      expect(second.requestId).toBe(first.requestId)
      expect(verifyAccessToken).toHaveBeenCalledTimes(1)
    })

    it('resolves independently across different requests', async () => {
      cookiesReturn({
        byline_access_token: 'valid-access',
        byline_refresh_token: 'some-refresh',
      })
      verifyAccessToken.mockResolvedValue({ actor: stubActor() })

      bridge.getRequest.mockReturnValue({ id: 'request-a' })
      const first = await getAdminRequestContext()
      bridge.getRequest.mockReturnValue({ id: 'request-b' })
      const second = await getAdminRequestContext()

      expect(second).not.toBe(first)
      expect(second.requestId).not.toBe(first.requestId)
      expect(verifyAccessToken).toHaveBeenCalledTimes(2)
    })

    it('burns at most one refresh rotation per request', async () => {
      bridge.getRequest.mockReturnValue({ id: 'request-a' })
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

      const first = await getAdminRequestContext()
      // A second unmemoized call would re-run the refresh dance against the
      // request's stale cookie — now already rotated — and sign the admin out.
      const second = await getAdminRequestContext()

      expect(second).toBe(first)
      expect(refreshSession).toHaveBeenCalledTimes(1)
    })

    it('memoizes the unauthenticated rejection within one request', async () => {
      bridge.getRequest.mockReturnValue({ id: 'request-a' })
      cookiesReturn({
        byline_access_token: 'stale',
        byline_refresh_token: 'bad-refresh',
      })
      verifyAccessToken.mockRejectedValue(new Error('expired'))
      refreshSession.mockRejectedValue(new Error('revoked'))

      await expect(getAdminRequestContext()).rejects.toMatchObject({
        code: AuthErrorCodes.UNAUTHENTICATED,
      })
      await expect(getAdminRequestContext()).rejects.toMatchObject({
        code: AuthErrorCodes.UNAUTHENTICATED,
      })
      expect(refreshSession).toHaveBeenCalledTimes(1)
    })
  })
})
