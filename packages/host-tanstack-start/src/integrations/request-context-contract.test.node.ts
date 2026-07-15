/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Cross-layer contract test: a real `BylineClient` wired to the real
 * cookie-derived host factory (`getAdminRequestContext`) under a mocked
 * Start request, running two operations that share one `ReadContext`.
 *
 * This is the seam every per-layer suite missed when the admin tree view
 * broke with 'ReadContext cannot be reused across request authorities':
 * client tests used stable test contexts, host auth tests called the
 * factory once, and tree tests mocked the handle. Here the factory's
 * request-stability contract (see `BylineClientConfig.requestContext`)
 * is exercised end-to-end through the SDK's authority binding.
 */

import { AdminAuth } from '@byline/auth'
import { createBylineClient } from '@byline/client'
import type { CollectionDefinition, IDbAdapter } from '@byline/core'
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

import { createReadContext } from '@byline/core'

import { getAdminRequestContext } from '../auth/auth-context.js'

const postsCollection: CollectionDefinition = {
  path: 'posts',
  labels: { singular: 'Post', plural: 'Posts' },
  fields: [{ name: 'title', type: 'text', label: 'Title' }],
}

function mockDb(): IDbAdapter {
  return {
    commands: { collections: {}, documents: {}, counters: {} },
    queries: {
      collections: {
        getCollectionByPath: vi.fn().mockResolvedValue({ id: 'col-1', version: 1 }),
      },
      documents: {
        findDocuments: vi.fn().mockResolvedValue({ documents: [], total: 0 }),
        getDocumentsByDocumentIds: vi.fn().mockResolvedValue([]),
      },
    },
  } as unknown as IDbAdapter
}

describe('host factory ↔ client authority contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCookie.mockImplementation((name: string) =>
      name === 'byline_access_token' ? 'valid-access' : undefined
    )
    mocks.verifyAccessToken.mockResolvedValue({
      actor: new AdminAuth({ id: 'admin-1', abilities: ['collections.posts.read'] }),
    })
  })

  it('two reads sharing a ReadContext bind one authority within a request', async () => {
    mocks.getRequest.mockReturnValue({ id: 'request-a' })
    const db = mockDb()
    const beforeRead = vi.fn(() => ({ title: 'scoped' }))
    const client = createBylineClient({
      db,
      collections: [{ ...postsCollection, hooks: { beforeRead } }],
      requestContext: getAdminRequestContext,
    })
    const readContext = createReadContext()

    // The admin tree view shape: two top-level reads, one shared ReadContext.
    await client.collection('posts').find({ status: 'any', _readContext: readContext })
    await client.collection('posts').find({ status: 'any', _readContext: readContext })

    expect(db.queries.documents.findDocuments).toHaveBeenCalledTimes(2)
    // One session verification and one beforeRead compile for the whole
    // request — the factory resolved a single request-stable context.
    expect(mocks.verifyAccessToken).toHaveBeenCalledTimes(1)
    expect(beforeRead).toHaveBeenCalledTimes(1)
  })

  it('still rejects a ReadContext carried across two different requests', async () => {
    const db = mockDb()
    const client = createBylineClient({
      db,
      collections: [{ ...postsCollection, hooks: { beforeRead: () => ({ title: 'scoped' }) } }],
      requestContext: getAdminRequestContext,
    })
    const readContext = createReadContext()

    mocks.getRequest.mockReturnValue({ id: 'request-a' })
    await client.collection('posts').find({ status: 'any', _readContext: readContext })

    mocks.getRequest.mockReturnValue({ id: 'request-b' })
    await expect(
      client.collection('posts').find({ status: 'any', _readContext: readContext })
    ).rejects.toThrow('cannot be reused across request authorities')
  })
})
