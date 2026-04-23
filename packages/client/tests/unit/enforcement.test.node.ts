/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Client-level ability enforcement (Phase 4).
 *
 * Covers the edges of the `resolveAndAssertRead` / `buildLifecycleContext`
 * contract on `CollectionHandle`. The existing test files in this
 * directory already inject a super-admin context via `createBylineClient`
 * and therefore exercise the happy-path implicitly — this file focuses on
 * the negative cases and the super-admin bypass.
 */

import {
  AdminAuth,
  AuthError,
  AuthErrorCodes,
  createRequestContext,
  createSuperAdminContext,
} from '@byline/auth'
import type { CollectionDefinition, IDbAdapter } from '@byline/core'
import { describe, expect, it, vi } from 'vitest'

import { createBylineClient } from '../../src/index.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const postsCollection: CollectionDefinition = {
  path: 'posts',
  labels: { singular: 'Post', plural: 'Posts' },
  fields: [{ name: 'title', type: 'text', label: 'Title' }],
}

function mockDb(): IDbAdapter {
  const findDocuments = vi.fn().mockResolvedValue({ documents: [], total: 0 })
  const getCollectionByPath = vi.fn().mockResolvedValue({ id: 'col-1', version: 1 })
  return {
    commands: {
      collections: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      documents: {
        createDocumentVersion: vi.fn(),
        setDocumentStatus: vi.fn(),
        softDeleteDocument: vi.fn(),
        archivePublishedVersions: vi.fn(),
      },
    },
    queries: {
      collections: { getCollectionByPath },
      documents: {
        findDocuments,
        getDocumentById: vi.fn().mockResolvedValue(null),
        getCurrentVersionMetadata: vi.fn().mockResolvedValue(null),
        getDocumentByPath: vi.fn().mockResolvedValue(null),
        getDocumentByVersion: vi.fn().mockResolvedValue(null),
        getDocumentsByVersionIds: vi.fn().mockResolvedValue([]),
        getDocumentsByDocumentIds: vi.fn().mockResolvedValue([]),
        getDocumentHistory: vi.fn(),
        getPublishedVersion: vi.fn().mockResolvedValue(null),
        getPublishedDocumentIds: vi.fn().mockResolvedValue(new Set()),
        getDocumentCountsByStatus: vi.fn().mockResolvedValue([]),
      },
    },
  } as unknown as IDbAdapter
}

// ---------------------------------------------------------------------------

describe('CollectionHandle enforcement', () => {
  describe('missing requestContext on the client', () => {
    it('throws ERR_UNAUTHENTICATED on find()', async () => {
      const client = createBylineClient({
        db: mockDb(),
        collections: [postsCollection],
      })
      try {
        await client.collection('posts').find()
        expect.fail('expected ERR_UNAUTHENTICATED')
      } catch (err) {
        expect(err).toBeInstanceOf(AuthError)
        expect((err as AuthError).code).toBe(AuthErrorCodes.UNAUTHENTICATED)
      }
    })

    it('throws ERR_UNAUTHENTICATED on create()', async () => {
      const client = createBylineClient({
        db: mockDb(),
        collections: [postsCollection],
      })
      try {
        await client.collection('posts').create({ title: 'x' })
        expect.fail('expected ERR_UNAUTHENTICATED')
      } catch (err) {
        expect((err as AuthError).code).toBe(AuthErrorCodes.UNAUTHENTICATED)
      }
    })
  })

  describe('actor without abilities', () => {
    it('throws ERR_FORBIDDEN on read when collections.posts.read is missing', async () => {
      const actor = new AdminAuth({
        id: 'nobody',
        abilities: ['collections.other.read'], // has read for a different collection
      })
      const client = createBylineClient({
        db: mockDb(),
        collections: [postsCollection],
        requestContext: createRequestContext({ actor }),
      })
      try {
        await client.collection('posts').find()
        expect.fail('expected ERR_FORBIDDEN')
      } catch (err) {
        expect((err as AuthError).code).toBe(AuthErrorCodes.FORBIDDEN)
        expect((err as AuthError).message).toContain('collections.posts.read')
      }
    })

    it('permits read when the specific ability is held', async () => {
      const actor = new AdminAuth({
        id: 'reader',
        abilities: ['collections.posts.read'],
      })
      const client = createBylineClient({
        db: mockDb(),
        collections: [postsCollection],
        requestContext: createRequestContext({ actor }),
      })
      const result = await client.collection('posts').find()
      expect(result.docs).toEqual([])
    })
  })

  describe('public reader (null actor)', () => {
    it('permits read when readMode is "published"', async () => {
      const client = createBylineClient({
        db: mockDb(),
        collections: [postsCollection],
        requestContext: createRequestContext({ actor: null, readMode: 'published' }),
      })
      const result = await client.collection('posts').find()
      expect(result.docs).toEqual([])
    })

    it('rejects read when readMode is not "published"', async () => {
      const client = createBylineClient({
        db: mockDb(),
        collections: [postsCollection],
        requestContext: createRequestContext({ actor: null, readMode: 'any' }),
      })
      try {
        await client.collection('posts').find()
        expect.fail('expected ERR_UNAUTHENTICATED')
      } catch (err) {
        expect((err as AuthError).code).toBe(AuthErrorCodes.UNAUTHENTICATED)
      }
    })
  })

  describe('factory context', () => {
    it('resolves a fresh context per call', async () => {
      const contexts = [
        createSuperAdminContext({ id: 'ctx-1' }),
        createSuperAdminContext({ id: 'ctx-2' }),
      ]
      let call = 0
      const client = createBylineClient({
        db: mockDb(),
        collections: [postsCollection],
        requestContext: () => {
          const next = contexts[call] ?? contexts[0]
          call += 1
          return next!
        },
      })
      await client.collection('posts').find()
      await client.collection('posts').find()
      expect(call).toBe(2)
    })
  })

  describe('super-admin bypass', () => {
    it('reads without any explicit abilities', async () => {
      const client = createBylineClient({
        db: mockDb(),
        collections: [postsCollection],
        requestContext: createSuperAdminContext(),
      })
      const result = await client.collection('posts').find()
      expect(result.docs).toEqual([])
    })
  })
})
