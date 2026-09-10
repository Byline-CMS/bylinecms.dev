/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { ERR_ACCESS_EXPIRED, ERR_REVOKED_TOKEN, ERR_UNAUTHENTICATED } from '@byline/auth'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  refresh: 'refresh' as string | undefined,
  getById: vi.fn(),
}))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({ handler: (handler: any) => ({ handler }) }),
}))
vi.mock('@byline/client/server', () => ({
  getAdminRequestContext: mocks.context,
  readRefreshTokenCookie: () => mocks.refresh,
}))
vi.mock('../../integrations/byline-core.js', () => ({
  bylineCore: () => ({ adminStore: { adminUsers: { getById: mocks.getById } } }),
}))

import { getCurrentAdminSessionSoft } from './current-user.js'

const endpoint = getCurrentAdminSessionSoft as unknown as { handler: () => Promise<any> }
const row = {
  id: 'admin-1',
  email: 'editor@example.test',
  given_name: null,
  family_name: null,
  is_super_admin: false,
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.refresh = 'refresh'
})

describe('getCurrentAdminSessionSoft', () => {
  it('returns the user and no renewal hint when the access credential verifies', async () => {
    mocks.context.mockResolvedValue({
      actor: { id: 'admin-1', abilities: new Set(['collections.news.read']) },
      sessionId: 'login-1',
    })
    mocks.getById.mockResolvedValue(row)
    await expect(endpoint.handler()).resolves.toEqual({
      user: { ...row, sessionId: 'login-1', abilities: ['collections.news.read'] },
      renewable: false,
    })
  })

  it('reports a renewable session when access expired and a refresh credential is present', async () => {
    mocks.context.mockRejectedValue(ERR_ACCESS_EXPIRED({ message: 'expired' }))
    await expect(endpoint.handler()).resolves.toEqual({ user: null, renewable: true })
  })

  it('does not report renewable when access expired without a refresh credential', async () => {
    mocks.refresh = undefined
    mocks.context.mockRejectedValue(ERR_ACCESS_EXPIRED({ message: 'expired' }))
    await expect(endpoint.handler()).resolves.toEqual({ user: null, renewable: false })
  })

  it.each([
    ERR_UNAUTHENTICATED({ message: 'anonymous' }),
    ERR_REVOKED_TOKEN({ message: 'revoked' }),
    new Error('database unavailable'),
  ])('stays anonymous and non-renewable on %s', async (error) => {
    mocks.context.mockRejectedValue(error)
    await expect(endpoint.handler()).resolves.toEqual({ user: null, renewable: false })
  })

  it('stays anonymous when the session points at a deleted admin', async () => {
    mocks.context.mockResolvedValue({
      actor: { id: 'gone', abilities: new Set() },
      sessionId: 'login-1',
    })
    mocks.getById.mockResolvedValue(null)
    await expect(endpoint.handler()).resolves.toEqual({ user: null, renewable: false })
  })
})
