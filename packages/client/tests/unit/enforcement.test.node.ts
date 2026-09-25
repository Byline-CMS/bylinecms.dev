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
import { createReadContext, defineSingleton, ErrorCodes } from '@byline/core'
import { describe, expect, it, vi } from 'vitest'

import { createBylineClient } from '../../src/index.js'
import { testAdapter } from '../fixtures/test-adapter.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const postsCollection: CollectionDefinition = {
  path: 'posts',
  labels: { singular: 'Post', plural: 'Posts' },
  tree: true,
  search: { body: ['title'], zones: ['posts'] },
  fields: [{ name: 'title', type: 'text', label: 'Title' }],
}

function mockDb(): IDbAdapter {
  const findDocuments = vi
    .fn<IDbAdapter['queries']['documents']['findDocuments']>()
    .mockResolvedValue({ documents: [], total: 0 })
  const getCollectionByPath = vi.fn().mockResolvedValue({ id: 'col-1', version: 1 })
  return testAdapter({
    commands: {
      collections: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      documents: {
        createDocumentVersion: vi.fn(),
        setDocumentStatus: vi.fn(),
        softDeleteDocument: vi.fn(),
        restoreSoftDeletedDocument: vi.fn(),
        archivePublishedVersions: vi.fn(),
      },
      counters: {
        ensureCounterGroup: vi.fn(),
        nextCounterValue: vi.fn(),
        nextScopedCounterValue: vi.fn(),
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
        getTreeSubtree: vi.fn().mockResolvedValue([]),
        getTreeAncestors: vi.fn().mockResolvedValue([]),
        getTreeParent: vi.fn().mockResolvedValue({ placed: false, parentDocumentId: null }),
      },
    },
  })
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

    it('uses the operation default instead of a stale context readMode', async () => {
      const source = createRequestContext({ actor: null, readMode: 'any' })
      const client = createBylineClient({
        db: mockDb(),
        collections: [postsCollection],
        requestContext: source,
      })
      await expect(client.collection('posts').find()).resolves.toMatchObject({ docs: [] })
      expect(source.readMode).toBe('any')
    })

    it.each([
      [
        'find',
        (client: ReturnType<typeof createBylineClient>) =>
          client.collection('posts').find({ status: 'any' }),
      ],
      [
        'findOne',
        (client: ReturnType<typeof createBylineClient>) =>
          client.collection('posts').findOne({ status: 'any' }),
      ],
      [
        'findById',
        (client: ReturnType<typeof createBylineClient>) =>
          client.collection('posts').findById('doc-1', { status: 'any' }),
      ],
      [
        'findByPath',
        (client: ReturnType<typeof createBylineClient>) =>
          client.collection('posts').findByPath('doc-1', { status: 'any' }),
      ],
      [
        'collection search',
        (client: ReturnType<typeof createBylineClient>) =>
          client.collection('posts').search({ query: 'x', status: 'any' }),
      ],
      [
        'zone search',
        (client: ReturnType<typeof createBylineClient>) =>
          client.search({ query: 'x', zone: 'posts', status: 'any' }),
      ],
      [
        'subtree',
        (client: ReturnType<typeof createBylineClient>) =>
          client.collection('posts').getSubtree({ status: 'any' }),
      ],
      [
        'ancestors',
        (client: ReturnType<typeof createBylineClient>) =>
          client.collection('posts').getAncestors('doc-1', { status: 'any' }),
      ],
      [
        'tree parent',
        (client: ReturnType<typeof createBylineClient>) =>
          client.collection('posts').getTreeParent('doc-1', { status: 'any' }),
      ],
      [
        'history',
        (client: ReturnType<typeof createBylineClient>) =>
          client.collection('posts').history('doc-1'),
      ],
      [
        'version',
        (client: ReturnType<typeof createBylineClient>) =>
          client.collection('posts').findByVersion('version-1'),
      ],
      [
        'audit log',
        (client: ReturnType<typeof createBylineClient>) =>
          client.collection('posts').auditLog('doc-1'),
      ],
      [
        'counts',
        (client: ReturnType<typeof createBylineClient>) =>
          client.collection('posts').countByStatus(),
      ],
    ])('rejects effective any-mode on %s', async (_name, read) => {
      const client = createBylineClient({
        db: mockDb(),
        collections: [postsCollection],
        requestContext: createRequestContext({ actor: null, readMode: 'published' }),
        search: {
          capabilities: {},
          upsert: vi.fn(),
          remove: vi.fn(),
          search: vi.fn().mockResolvedValue({ hits: [], total: 0 }),
        } as any,
      })

      await expect(read(client)).rejects.toMatchObject({ code: AuthErrorCodes.UNAUTHENTICATED })
    })

    it('passes the operation-effective read mode to beforeRead without mutating the source context', async () => {
      const source = createRequestContext({
        actor: new AdminAuth({ id: 'reader', abilities: ['collections.scoped.read'] }),
        readMode: 'published',
      })
      const observed: Array<string | undefined> = []
      const scoped: CollectionDefinition = {
        ...postsCollection,
        path: 'scoped',
        hooks: {
          beforeRead: ({ requestContext }) => {
            observed.push(requestContext.readMode)
          },
        },
      }
      const client = createBylineClient({
        db: mockDb(),
        collections: [scoped],
        requestContext: source,
      })

      await client.collection('scoped').find({ status: 'any' })

      expect(observed).toEqual(['any'])
      expect(source.readMode).toBe('published')
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
          if (next == null) throw new Error('missing test request context')
          return next
        },
      })
      await client.collection('posts').find()
      await client.collection('posts').find()
      expect(call).toBe(2)
    })

    it('rejects a shared ReadContext when the factory authority changes', async () => {
      const contexts = [
        createRequestContext({
          actor: new AdminAuth({ id: 'alice', abilities: ['collections.posts.read'] }),
        }),
        createRequestContext({
          actor: new AdminAuth({ id: 'bob', abilities: ['collections.posts.read'] }),
        }),
      ]
      let current = 0
      const db = mockDb()
      const hook = vi.fn(({ requestContext }) => ({ title: requestContext.actor?.id }))
      const client = createBylineClient({
        db,
        collections: [{ ...postsCollection, hooks: { beforeRead: hook } }],
        requestContext: () => {
          const context = contexts[current]
          if (context == null) throw new Error('missing test request context')
          return context
        },
      })
      const readContext = createReadContext()

      await client.collection('posts').find({ _readContext: readContext })
      current = 1
      await expect(client.collection('posts').find({ _readContext: readContext })).rejects.toThrow(
        'cannot be reused across request authorities'
      )
      expect(hook).toHaveBeenCalledOnce()
      expect(db.queries.documents.findDocuments).toHaveBeenCalledOnce()
    })

    it('does not reuse same-path security filters across clients and definitions', async () => {
      const db = mockDb()
      const context = createRequestContext({
        actor: new AdminAuth({ id: 'reader', abilities: ['collections.posts.read'] }),
      })
      const hookA = vi.fn(() => ({ title: 'allowed-a' }))
      const hookB = vi.fn(() => ({ title: 'allowed-b' }))
      const definitionA: CollectionDefinition = {
        ...postsCollection,
        hooks: { beforeRead: hookA },
      }
      const definitionB: CollectionDefinition = {
        ...postsCollection,
        hooks: { beforeRead: hookB },
      }
      const clientA = createBylineClient({
        db,
        collections: [definitionA],
        requestContext: context,
      })
      const clientB = createBylineClient({
        db,
        collections: [definitionB],
        requestContext: context,
      })
      const readContext = createReadContext()

      await clientA.collection('posts').find({ _readContext: readContext })
      await clientB.collection('posts').find({ _readContext: readContext })

      expect(hookA).toHaveBeenCalledOnce()
      expect(hookB).toHaveBeenCalledOnce()
      expect(db.queries.documents.findDocuments).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          filters: [expect.objectContaining({ fieldName: 'title', value: 'allowed-a' })],
        })
      )
      expect(db.queries.documents.findDocuments).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          filters: [expect.objectContaining({ fieldName: 'title', value: 'allowed-b' })],
        })
      )
    })

    it('does not reuse compiled filters across clients sharing the exact db and definitions', async () => {
      const db = mockDb()
      const getCollectionByPath = vi.mocked(db.queries.collections.getCollectionByPath)
      let categoryId = 'categories-a'
      getCollectionByPath.mockImplementation(async (path) => ({
        id: path === 'categories' ? categoryId : 'posts-id',
        path,
        version: 1,
      }))
      const hook = vi.fn(() => ({ category: { title: 'Allowed' } }))
      const definition: CollectionDefinition = {
        ...postsCollection,
        fields: [
          ...postsCollection.fields,
          {
            name: 'category',
            type: 'relation',
            label: 'Category',
            targetCollection: 'categories',
          },
        ],
        hooks: { beforeRead: hook },
      }
      const categories: CollectionDefinition = {
        path: 'categories',
        labels: { singular: 'Category', plural: 'Categories' },
        fields: [{ name: 'title', type: 'text', label: 'Title' }],
      }
      const collections = [definition, categories] as const
      const context = createRequestContext({
        actor: new AdminAuth({ id: 'reader', abilities: ['collections.posts.read'] }),
      })
      const clientA = createBylineClient({ db, collections, requestContext: context })
      const clientB = createBylineClient({ db, collections, requestContext: context })
      const readContext = createReadContext()

      await clientA.resolveCollectionId('categories')
      categoryId = 'categories-b'
      await clientB.resolveCollectionId('categories')
      await clientA.collection('posts').find({ _readContext: readContext })
      await clientB.collection('posts').find({ _readContext: readContext })

      const findDocuments = vi.mocked(db.queries.documents.findDocuments)
      expect(findDocuments.mock.calls[0]?.[0].filters).toEqual([
        expect.objectContaining({ kind: 'relation', targetCollectionId: 'categories-a' }),
      ])
      expect(findDocuments.mock.calls[1]?.[0].filters).toEqual([
        expect.objectContaining({ kind: 'relation', targetCollectionId: 'categories-b' }),
      ])
      expect(hook).toHaveBeenCalledTimes(2)
    })

    it.each([
      [
        'requestId',
        createRequestContext({
          actor: new AdminAuth({ id: 'reader', abilities: ['collections.posts.read'] }),
          requestId: 'request-a',
          locale: 'en',
        }),
        createRequestContext({
          actor: new AdminAuth({ id: 'reader', abilities: ['collections.posts.read'] }),
          requestId: 'request-b',
          locale: 'en',
        }),
      ],
      [
        'locale',
        createRequestContext({
          actor: new AdminAuth({ id: 'reader', abilities: ['collections.posts.read'] }),
          requestId: 'shared-request',
          locale: 'en',
        }),
        createRequestContext({
          actor: new AdminAuth({ id: 'reader', abilities: ['collections.posts.read'] }),
          requestId: 'shared-request',
          locale: 'fr',
        }),
      ],
    ])('rejects shared ReadContext reuse when %s changes', async (_field, first, second) => {
      let current = first
      const db = mockDb()
      const hook = vi.fn(({ requestContext }) => ({ title: requestContext.locale }))
      const client = createBylineClient({
        db,
        collections: [{ ...postsCollection, hooks: { beforeRead: hook } }],
        requestContext: () => current,
      })
      const readContext = createReadContext()

      await client.collection('posts').find({ _readContext: readContext })
      current = second
      await expect(client.collection('posts').find({ _readContext: readContext })).rejects.toThrow(
        'cannot be reused across request authorities'
      )

      expect(hook).toHaveBeenCalledOnce()
      expect(db.queries.documents.findDocuments).toHaveBeenCalledOnce()
    })
  })

  describe('historical version scoping', () => {
    it('binds version reads to the handle collection and beforeRead predicate', async () => {
      const db = mockDb()
      const getDocumentByVersion = vi.mocked(db.queries.documents.getDocumentByVersion)
      getDocumentByVersion.mockImplementation(async (params) => {
        if (params.document_version_id !== 'own-version' || params.collection_id !== 'col-1') {
          return null
        }
        return {
          document_version_id: 'own-version',
          document_id: 'doc-1',
          collection_id: 'col-1',
          path: 'doc-1',
          status: 'draft',
          created_at: new Date('2026-01-01'),
          updated_at: new Date('2026-01-01'),
          fields: { title: 'Own', owner: 'alice' },
        }
      })
      const scoped: CollectionDefinition = {
        ...postsCollection,
        fields: [...postsCollection.fields, { name: 'owner', type: 'text', label: 'Owner' }],
        hooks: { beforeRead: () => ({ owner: 'alice' }) },
      }
      const client = createBylineClient({
        db,
        collections: [scoped],
        requestContext: createSuperAdminContext(),
      })

      await expect(client.collection('posts').findByVersion('unknown')).resolves.toBeNull()
      await expect(client.collection('posts').findByVersion('foreign-version')).resolves.toBeNull()
      await expect(client.collection('posts').findByVersion('own-version')).resolves.toMatchObject({
        id: 'doc-1',
      })
      expect(getDocumentByVersion).toHaveBeenLastCalledWith(
        expect.objectContaining({
          collection_id: 'col-1',
          filters: [expect.objectContaining({ kind: 'field', fieldName: 'owner', value: 'alice' })],
        })
      )
    })
  })

  describe('search query contracts', () => {
    it('passes full-text field scope and matching intent through collection and zone search', async () => {
      const providerSearch = vi.fn().mockResolvedValue({ hits: [], total: 0 })
      const client = createBylineClient({
        db: mockDb(),
        collections: [postsCollection],
        requestContext: createSuperAdminContext(),
        search: {
          capabilities: { fullText: { fieldScope: true } },
          upsert: vi.fn(),
          remove: vi.fn(),
          search: providerSearch,
        } as any,
      })

      await client.collection('posts').search({
        query: 'forest restoration',
        fieldScope: ['title'],
        matching: { operator: 'any', minimumShouldMatch: 1, phrase: 'off' },
      })
      await client.search({
        query: '"forest restoration"',
        zone: 'posts',
        fieldScope: ['title', 'summary'],
        matching: { operator: 'all', phrase: 'required' },
      })

      expect(providerSearch).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          fieldScope: ['title'],
          matching: { operator: 'any', minimumShouldMatch: 1, phrase: 'off' },
        })
      )
      expect(providerSearch).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          fieldScope: ['title', 'summary'],
          matching: { operator: 'all', phrase: 'required' },
        })
      )
    })

    it('rejects field scope when the provider does not advertise it', async () => {
      const providerSearch = vi.fn().mockResolvedValue({ hits: [], total: 0 })
      const client = createBylineClient({
        db: mockDb(),
        collections: [postsCollection],
        requestContext: createSuperAdminContext(),
        search: {
          capabilities: { fullText: { fieldScope: false } },
          upsert: vi.fn(),
          remove: vi.fn(),
          search: providerSearch,
        } as any,
      })

      await expect(
        client.collection('posts').search({ query: 'forest', fieldScope: ['title'] })
      ).rejects.toMatchObject({ code: 'ERR_VALIDATION' })
      expect(providerSearch).not.toHaveBeenCalled()
    })
  })

  describe('beforeRead predicates fail closed', () => {
    it.each([
      [{ typoedOwner: 'alice' }, 'unknown field'],
      [{ query: 'secret' }, 'not supported'],
      [{ $or: [] }, 'non-empty array'],
    ])('rejects invalid hook predicate %o', async (predicate, message) => {
      const db = mockDb()
      const scoped: CollectionDefinition = {
        ...postsCollection,
        hooks: { beforeRead: () => predicate },
      }
      const client = createBylineClient({
        db,
        collections: [scoped],
        requestContext: createSuperAdminContext(),
      })

      await expect(client.collection('posts').find()).rejects.toThrow(message)
      expect(db.queries.collections.getCollectionByPath).not.toHaveBeenCalled()
      expect(db.queries.documents.findDocuments).not.toHaveBeenCalled()
    })

    it('rejects a malformed predicate before invoking the search provider', async () => {
      const db = mockDb()
      const providerSearch = vi.fn().mockResolvedValue({ hits: [], total: 0 })
      const scoped: CollectionDefinition = {
        ...postsCollection,
        hooks: { beforeRead: () => ({ typoedOwner: 'alice' }) },
      }
      const client = createBylineClient({
        db,
        collections: [scoped],
        requestContext: createSuperAdminContext(),
        search: {
          capabilities: {},
          upsert: vi.fn(),
          remove: vi.fn(),
          search: providerSearch,
        } as any,
      })

      await expect(client.collection('posts').search({ query: 'hidden' })).rejects.toThrow(
        'unknown field'
      )
      expect(db.queries.collections.getCollectionByPath).not.toHaveBeenCalled()
      expect(providerSearch).not.toHaveBeenCalled()
    })

    it.each([
      ['status $in', { status: { $in: ['published'] } }, 'status', '$in', ['published']],
      ['path $nin', { path: { $nin: ['private'] } }, 'path', '$nin', ['private']],
    ])(
      'appends top-level %s security filters identically with and without caller where',
      async (_name, predicate, column, operator, value) => {
        for (const where of [undefined, { unknownCallerField: 'kept-permissive' }]) {
          const db = mockDb()
          const scoped: CollectionDefinition = {
            ...postsCollection,
            hooks: { beforeRead: () => predicate },
          }
          const client = createBylineClient({
            db,
            collections: [scoped],
            requestContext: createSuperAdminContext(),
          })

          await client.collection('posts').find({ where })

          expect(db.queries.documents.findDocuments).toHaveBeenCalledWith(
            expect.objectContaining({
              filters: [{ kind: 'docColumn', column, operator, value }],
              status: undefined,
              pathFilter: undefined,
            })
          )
        }
      }
    )

    it('reuses one strict compilation and collection-id resolution during search finishing', async () => {
      const db = mockDb()
      const hook = vi.fn(() => ({ parent: { title: 'Root' } }))
      const scoped: CollectionDefinition = {
        ...postsCollection,
        fields: [
          ...postsCollection.fields,
          {
            name: 'parent',
            type: 'relation',
            label: 'Parent',
            targetCollection: 'posts',
          },
        ],
        hooks: { beforeRead: hook },
      }
      const providerSearch = vi.fn().mockResolvedValue({
        hits: [
          {
            collectionPath: 'posts',
            documentId: 'p1',
            locale: 'en',
            title: 'Post',
            path: 'post',
            score: 1,
          },
        ],
        total: 1,
      })
      const client = createBylineClient({
        db,
        collections: [scoped],
        requestContext: createSuperAdminContext(),
        search: {
          capabilities: {},
          upsert: vi.fn(),
          remove: vi.fn(),
          search: providerSearch,
        } as any,
      })

      await client.collection('posts').search({ query: 'post' })

      expect(hook).toHaveBeenCalledOnce()
      expect(db.queries.collections.getCollectionByPath).toHaveBeenCalledOnce()
      expect(db.queries.documents.findDocuments).toHaveBeenCalledOnce()
    })

    it('suppresses provider totals and facets when row scoping applies', async () => {
      const scoped: CollectionDefinition = {
        ...postsCollection,
        fields: [...postsCollection.fields, { name: 'owner', type: 'text', label: 'Owner' }],
        hooks: { beforeRead: () => ({ owner: 'alice' }) },
      }
      const client = createBylineClient({
        db: mockDb(),
        collections: [scoped],
        requestContext: createSuperAdminContext(),
        search: {
          capabilities: {},
          upsert: vi.fn(),
          remove: vi.fn(),
          search: vi.fn().mockResolvedValue({
            hits: [
              {
                collectionPath: 'posts',
                documentId: 'hidden',
                locale: 'en',
                title: 'Hidden',
                path: 'hidden',
                score: 1,
              },
            ],
            total: 99,
            facets: { owner: [{ value: 'alice', count: 99 }] },
          }),
        } as any,
      })

      await expect(client.collection('posts').search({ query: 'hidden' })).resolves.toEqual({
        hits: [],
        total: 0,
      })
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

  describe('locale visibility', () => {
    type Client = ReturnType<typeof createBylineClient>
    type ReadOptions = {
      status?: 'published' | 'any'
      localeVisibility?: 'public' | 'editorial'
      locale?: string
      _bypassBeforeRead?: true
    }

    // Every read method that accepts `status` also accepts `localeVisibility`.
    const reads: Array<[string, (client: Client, options: ReadOptions) => Promise<unknown>]> = [
      ['find', (client, options) => client.collection('posts').find(options)],
      ['findOne', (client, options) => client.collection('posts').findOne(options)],
      ['findById', (client, options) => client.collection('posts').findById('doc-1', options)],
      ['findByPath', (client, options) => client.collection('posts').findByPath('doc-1', options)],
      ['subtree', (client, options) => client.collection('posts').getSubtree(options)],
      ['ancestors', (client, options) => client.collection('posts').getAncestors('doc-1', options)],
      [
        'tree parent',
        (client, options) => client.collection('posts').getTreeParent('doc-1', options),
      ],
    ]

    function clientFor(requestContext: ReturnType<typeof createRequestContext>): Client {
      return createBylineClient({ db: mockDb(), collections: [postsCollection], requestContext })
    }

    const anonymous = () => createRequestContext({ actor: null, readMode: 'published' })

    it.each(reads)('rejects an anonymous editorial read on %s', async (_name, read) => {
      await expect(
        read(clientFor(anonymous()), { localeVisibility: 'editorial' })
      ).rejects.toMatchObject({ code: AuthErrorCodes.UNAUTHENTICATED })
    })

    it.each(reads)(
      'rejects an anonymous editorial read on %s even with _bypassBeforeRead',
      async (_name, read) => {
        await expect(
          read(clientFor(anonymous()), { localeVisibility: 'editorial', _bypassBeforeRead: true })
        ).rejects.toMatchObject({ code: AuthErrorCodes.UNAUTHENTICATED })
      }
    )

    it.each(reads)('rejects a public locale all read on %s', async (_name, read) => {
      for (const ctx of [anonymous(), createSuperAdminContext({ id: 'admin' })]) {
        await expect(read(clientFor(ctx), { locale: 'all' })).rejects.toMatchObject({
          code: ErrorCodes.VALIDATION,
        })
      }
    })

    it.each(reads)(
      'rejects a public locale all read on %s even with _bypassBeforeRead',
      async (_name, read) => {
        await expect(
          read(clientFor(createSuperAdminContext({ id: 'admin' })), {
            locale: 'all',
            _bypassBeforeRead: true,
          })
        ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION })
      }
    )

    it.each(reads)('permits an anonymous public read of one locale on %s', async (_name, read) => {
      await expect(read(clientFor(anonymous()), { locale: 'es' })).resolves.not.toThrow()
    })

    it.each(reads)(
      'permits an authorized editorial read of the published version on %s',
      async (_name, read) => {
        const actor = new AdminAuth({ id: 'reviewer', abilities: ['collections.posts.read'] })
        const client = clientFor(createRequestContext({ actor }))
        await expect(
          read(client, { status: 'published', localeVisibility: 'editorial', locale: 'es' })
        ).resolves.not.toThrow()
      }
    )

    it.each(reads)(
      'status any defaults to editorial, so locale all is permitted on %s',
      async (_name, read) => {
        const client = clientFor(createSuperAdminContext({ id: 'admin' }))
        await expect(read(client, { status: 'any', locale: 'all' })).resolves.not.toThrow()
      }
    )

    it('an explicit public visibility overrides the status any default', async () => {
      const client = clientFor(createSuperAdminContext({ id: 'admin' }))
      await expect(
        client
          .collection('posts')
          .find({ status: 'any', localeVisibility: 'public', locale: 'all' })
      ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION })
    })

    it('denies an editorial read to an actor without the collection read ability', async () => {
      const actor = new AdminAuth({ id: 'nobody', abilities: ['collections.other.read'] })
      await expect(
        clientFor(createRequestContext({ actor }))
          .collection('posts')
          .find({ localeVisibility: 'editorial' })
      ).rejects.toMatchObject({ code: AuthErrorCodes.FORBIDDEN })
    })

    it('editing reads are editorial and pass authorization with locale all', async () => {
      // This unit fixture does not implement the editable read snapshot, so the
      // read fails after authorization. Reaching the adapter proves that neither
      // the visibility check nor the collection read check rejected it.
      const client = clientFor(createSuperAdminContext({ id: 'admin' }))
      const outcome = await client
        .collection('posts')
        .findForEdit({ locale: 'all' })
        .then(
          () => 'resolved',
          (err: Error) => err.message
        )
      expect(outcome).toMatch(/Unexpected adapter operation in unit fixture|resolved/)
    })
  })

  describe('locale visibility uses the effective locale (CP2-F2)', () => {
    type Client = ReturnType<typeof createBylineClient>
    const reads: Array<[string, (client: Client) => Promise<unknown>]> = [
      ['find', (client) => client.collection('posts').find()],
      ['findOne', (client) => client.collection('posts').findOne()],
      ['findById', (client) => client.collection('posts').findById('doc-1')],
      ['findByPath', (client) => client.collection('posts').findByPath('doc-1')],
      ['subtree', (client) => client.collection('posts').getSubtree()],
      ['ancestors', (client) => client.collection('posts').getAncestors('doc-1')],
      ['tree parent', (client) => client.collection('posts').getTreeParent('doc-1')],
    ]

    it.each(reads)(
      'rejects a public read on %s whose omitted locale inherits defaultLocale all, before adapter work',
      async (_name, read) => {
        for (const requestContext of [
          createRequestContext({ actor: null, readMode: 'published' }),
          createSuperAdminContext({ id: 'admin' }),
        ]) {
          const db = mockDb()
          const client = createBylineClient({
            db,
            collections: [postsCollection],
            requestContext,
            defaultLocale: 'all',
          })
          await expect(read(client)).rejects.toMatchObject({ code: ErrorCodes.VALIDATION })
          const documents = db.queries.documents
          for (const query of [
            documents.findDocuments,
            documents.getDocumentById,
            documents.getDocumentByPath,
            documents.getTreeSubtree,
            documents.getTreeAncestors,
            documents.getTreeParent,
          ]) {
            expect(query).not.toHaveBeenCalled()
          }
        }
      }
    )

    it('still permits an editorial read that inherits defaultLocale all', async () => {
      const client = createBylineClient({
        db: mockDb(),
        collections: [postsCollection],
        requestContext: createSuperAdminContext({ id: 'admin' }),
        defaultLocale: 'all',
      })
      await expect(client.collection('posts').find({ status: 'any' })).resolves.toMatchObject({
        docs: [],
      })
    })
  })

  describe('singleton get locale visibility (CP2-F1)', () => {
    const settings = defineSingleton({
      path: 'settings',
      label: 'Settings',
      fields: [{ name: 'title', type: 'text', localized: true }],
    })

    function singletonClient(
      requestContext: ReturnType<typeof createRequestContext>,
      mappedDocumentId: string | null,
      defaultLocale?: string
    ) {
      const db = mockDb()
      const getMappedDocumentId = vi.fn().mockResolvedValue(mappedDocumentId)
      ;(db.queries as Record<string, unknown>).singletons = { getMappedDocumentId }
      const client = createBylineClient({
        db,
        collections: [settings],
        requestContext,
        ...(defaultLocale != null ? { defaultLocale } : {}),
      })
      return { singleton: client.singleton('settings'), getMappedDocumentId, db }
    }

    const anonymous = () => createRequestContext({ actor: null, readMode: 'published' })
    const slots: Array<[string, string | null]> = [
      ['an unmaterialized slot', null],
      ['a mapped slot', 'doc-1'],
    ]

    it.each(slots)(
      'rejects an anonymous editorial get on %s before the slot lookup',
      async (_name, mapped) => {
        const { singleton, getMappedDocumentId, db } = singletonClient(anonymous(), mapped)
        await expect(singleton.get({ localeVisibility: 'editorial' })).rejects.toMatchObject({
          code: AuthErrorCodes.UNAUTHENTICATED,
        })
        expect(getMappedDocumentId).not.toHaveBeenCalled()
        expect(db.queries.documents.getDocumentById).not.toHaveBeenCalled()
      }
    )

    it.each(slots)(
      'rejects a public locale all get on %s before the slot lookup',
      async (_name, mapped) => {
        for (const ctx of [anonymous(), createSuperAdminContext({ id: 'admin' })]) {
          const { singleton, getMappedDocumentId, db } = singletonClient(ctx, mapped)
          await expect(singleton.get({ locale: 'all' })).rejects.toMatchObject({
            code: ErrorCodes.VALIDATION,
          })
          expect(getMappedDocumentId).not.toHaveBeenCalled()
          expect(db.queries.documents.getDocumentById).not.toHaveBeenCalled()
        }
      }
    )

    it.each(slots)(
      'rejects a public get on %s that inherits defaultLocale all',
      async (_name, mapped) => {
        const { singleton, getMappedDocumentId } = singletonClient(anonymous(), mapped, 'all')
        await expect(singleton.get()).rejects.toMatchObject({ code: ErrorCodes.VALIDATION })
        expect(getMappedDocumentId).not.toHaveBeenCalled()
      }
    )

    it.each(slots)('permits an authorized published editorial get on %s', async (_name, mapped) => {
      const actor = new AdminAuth({ id: 'reviewer', abilities: ['singletons.settings.read'] })
      const { singleton, getMappedDocumentId } = singletonClient(
        createRequestContext({ actor }),
        mapped
      )
      await expect(
        singleton.get({ status: 'published', localeVisibility: 'editorial', locale: 'es' })
      ).resolves.toBeNull()
      expect(getMappedDocumentId).toHaveBeenCalledTimes(1)
    })

    it.each(slots)('permits an anonymous public get of one locale on %s', async (_name, mapped) => {
      const { singleton, getMappedDocumentId } = singletonClient(anonymous(), mapped)
      await expect(singleton.get({ locale: 'es' })).resolves.toBeNull()
      expect(getMappedDocumentId).toHaveBeenCalledTimes(1)
    })
  })
})
