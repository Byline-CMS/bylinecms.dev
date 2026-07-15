/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Direct regression coverage for the public and viewer request-context
 * factories: both must be request-stable (same instance, same requestId,
 * for every call within one Start request) so reads sharing a
 * `ReadContext` bind a single request authority.
 */

import { AdminAuth } from '@byline/auth'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
  refreshSession: vi.fn(),
  getCookie: vi.fn(),
  setCookie: vi.fn(),
  getRequestHeader: vi.fn(),
  getRequest: vi.fn(),
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
  getRequest: mocks.getRequest,
}))

import { resolvePublicRequestContext } from './byline-public-client.js'
import { resolveViewerRequestContext } from './byline-viewer-client.js'

function cookiesReturn(values: Record<string, string | undefined>) {
  mocks.getCookie.mockImplementation((name: string) => values[name])
}

describe('request-context factories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRequest.mockImplementation(() => {
      throw new Error('No StartEvent found in AsyncLocalStorage')
    })
    cookiesReturn({})
  })

  describe('resolvePublicRequestContext', () => {
    it('returns the same anonymous published context for every call in one request', async () => {
      mocks.getRequest.mockReturnValue({ id: 'request-a' })

      const first = await resolvePublicRequestContext()
      const second = await resolvePublicRequestContext()

      expect(second).toBe(first)
      expect(first.actor).toBeNull()
      expect(first.readMode).toBe('published')
      expect(second.requestId).toBe(first.requestId)
    })

    it('resolves independently across requests', async () => {
      mocks.getRequest.mockReturnValue({ id: 'request-a' })
      const first = await resolvePublicRequestContext()
      mocks.getRequest.mockReturnValue({ id: 'request-b' })
      const second = await resolvePublicRequestContext()

      expect(second).not.toBe(first)
      expect(second.requestId).not.toBe(first.requestId)
    })
  })

  describe('resolveViewerRequestContext', () => {
    it('returns the same anonymous context per request when no preview cookie is set', async () => {
      mocks.getRequest.mockReturnValue({ id: 'request-a' })

      const first = await resolveViewerRequestContext()
      const second = await resolveViewerRequestContext()

      expect(second).toBe(first)
      expect(first.actor).toBeNull()
      expect(first.readMode).toBe('published')
    })

    it('returns the same admin any-mode context per request in preview mode', async () => {
      mocks.getRequest.mockReturnValue({ id: 'request-a' })
      cookiesReturn({ byline_preview: '1', byline_access_token: 'valid-access' })
      const actor = new AdminAuth({ id: 'admin-1', abilities: [] })
      mocks.verifyAccessToken.mockResolvedValue({ actor })

      const first = await resolveViewerRequestContext()
      const second = await resolveViewerRequestContext()

      expect(second).toBe(first)
      expect(first.actor).toBe(actor)
      expect(first.readMode).toBe('any')
      // The viewer context and the nested admin resolution are both
      // memoized — one session verification per request, not per call.
      expect(mocks.verifyAccessToken).toHaveBeenCalledTimes(1)
    })

    it('falls back to one stable anonymous context when the preview session is stale', async () => {
      mocks.getRequest.mockReturnValue({ id: 'request-a' })
      cookiesReturn({ byline_preview: '1', byline_access_token: 'stale' })
      mocks.verifyAccessToken.mockRejectedValue(new Error('expired'))

      const first = await resolveViewerRequestContext()
      const second = await resolveViewerRequestContext()

      expect(second).toBe(first)
      expect(first.actor).toBeNull()
      expect(first.readMode).toBe('published')
    })

    it('resolves independently across requests', async () => {
      mocks.getRequest.mockReturnValue({ id: 'request-a' })
      const first = await resolveViewerRequestContext()
      mocks.getRequest.mockReturnValue({ id: 'request-b' })
      const second = await resolveViewerRequestContext()

      expect(second).not.toBe(first)
      expect(second.requestId).not.toBe(first.requestId)
    })
  })
})
