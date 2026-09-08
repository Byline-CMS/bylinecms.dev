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

import {
  AdminAuth,
  AuthError,
  AuthErrorCodes,
  ERR_ACCESS_EXPIRED,
  ERR_REVOKED_TOKEN,
} from '@byline/auth'
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
    verifyAccessToken.mockResolvedValueOnce({ actor, sessionId: 'test-login' })

    const ctx = await getAdminRequestContext()

    expect(ctx.actor).toBe(actor)
    expect(ctx.readMode).toBe('any')
    expect(refreshSession).not.toHaveBeenCalled()
    expect(setCookie).not.toHaveBeenCalled()
  })

  it.each([
    ERR_ACCESS_EXPIRED({ message: 'expired' }),
    ERR_REVOKED_TOKEN({ message: 'revoked' }),
    new Error('database unavailable'),
  ])('never renews or writes cookies after verification failure: %s', async (error) => {
    cookiesReturn({ byline_access_token: 'old', byline_refresh_token: 'retained' })
    verifyAccessToken.mockRejectedValueOnce(error)
    await expect(getAdminRequestContext()).rejects.toBe(error)
    expect(refreshSession).not.toHaveBeenCalled()
    expect(setCookie).not.toHaveBeenCalled()
  })

  it('reports explicit renewal required when only the persistent refresh cookie survives', async () => {
    cookiesReturn({ byline_refresh_token: 'retained' })
    await expect(getAdminRequestContext()).rejects.toMatchObject({ code: 'ERR_ACCESS_EXPIRED' })
    expect(verifyAccessToken).not.toHaveBeenCalled()
    expect(refreshSession).not.toHaveBeenCalled()
    expect(setCookie).not.toHaveBeenCalled()
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

  describe('per-request memoization', () => {
    it('returns the same context instance — and requestId — for every call in one request', async () => {
      bridge.getRequest.mockReturnValue({ id: 'request-a' })
      cookiesReturn({
        byline_access_token: 'valid-access',
        byline_refresh_token: 'some-refresh',
      })
      verifyAccessToken.mockResolvedValue({ actor: stubActor(), sessionId: 'test-login' })

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
      verifyAccessToken.mockResolvedValue({ actor: stubActor(), sessionId: 'test-login' })

      bridge.getRequest.mockReturnValue({ id: 'request-a' })
      const first = await getAdminRequestContext()
      bridge.getRequest.mockReturnValue({ id: 'request-b' })
      const second = await getAdminRequestContext()

      expect(second).not.toBe(first)
      expect(second.requestId).not.toBe(first.requestId)
      expect(verifyAccessToken).toHaveBeenCalledTimes(2)
    })

    it('memoizes expiry without any rotation or cookie write', async () => {
      bridge.getRequest.mockReturnValue({})
      cookiesReturn({ byline_access_token: 'expired', byline_refresh_token: 'retained' })
      verifyAccessToken.mockRejectedValue(ERR_ACCESS_EXPIRED({ message: 'expired' }))
      await expect(getAdminRequestContext()).rejects.toMatchObject({ code: 'ERR_ACCESS_EXPIRED' })
      await expect(getAdminRequestContext()).rejects.toMatchObject({ code: 'ERR_ACCESS_EXPIRED' })
      expect(verifyAccessToken).toHaveBeenCalledOnce()
      expect(refreshSession).not.toHaveBeenCalled()
      expect(setCookie).not.toHaveBeenCalled()
    })
  })
})
