/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createSuperAdminContext } from '@byline/auth'
import type { CollectionDefinition, IDbAdapter } from '@byline/core'
import { createReadContext, ErrorCodes } from '@byline/core'
import { describe, expect, it, vi } from 'vitest'

import { createBylineClient } from '../../src/index.js'

const superAdmin = createSuperAdminContext({ id: 'test-super-admin' })

// ---------------------------------------------------------------------------
// Fixtures — two collections so we can exercise populate + afterRead too.
// ---------------------------------------------------------------------------

function postsCollection(afterRead?: (ctx: any) => void | Promise<void>): CollectionDefinition {
  return {
    path: 'posts',
    labels: { singular: 'Post', plural: 'Posts' },
    fields: [
      { name: 'title', type: 'text', label: 'Title' },
      {
        name: 'author',
        type: 'relation',
        label: 'Author',
        targetCollection: 'authors',
        optional: true,
      },
    ],
    hooks: afterRead ? { afterRead } : undefined,
  }
}

function authorsCollection(afterRead?: (ctx: any) => void | Promise<void>): CollectionDefinition {
  return {
    path: 'authors',
    labels: { singular: 'Author', plural: 'Authors' },
    fields: [{ name: 'name', type: 'text', label: 'Name' }],
    hooks: afterRead ? { afterRead } : undefined,
  }
}

function rawDoc(collectionId: string, documentId: string, fields: Record<string, any>) {
  return {
    document_version_id: `ver:${documentId}`,
    document_id: documentId,
    collection_id: collectionId,
    path: documentId,
    status: 'published',
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    fields,
  }
}

function makeAdapter(fetchMap: Record<string, Record<string, any>> = {}) {
  const getCollectionByPath = vi.fn(async (path: string) => ({ id: path, path }))
  const findDocuments = vi.fn(async () => ({ documents: [], total: 0 }))
  const getDocumentById = vi.fn(async () => null)
  const getDocumentByPath = vi.fn(async () => null)
  const getDocumentByVersion = vi.fn(async () => null)
  const getDocumentHistory = vi.fn(async () => ({
    documents: [],
    meta: { total: 0, page: 1, page_size: 20, total_pages: 0, order: 'updated_at', desc: true },
  }))
  const getTreeSubtree = vi.fn(async () => [])
  const getTreeAncestors = vi.fn(async () => [])
  const getDocumentsByDocumentIds = vi.fn(
    async (params: { collection_id: string; document_ids: string[] }) => {
      const bucket = fetchMap[params.collection_id] ?? {}
      return params.document_ids.map((id) => bucket[id]).filter(Boolean)
    }
  )

  const db = {
    commands: {
      collections: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      documents: {
        createDocumentVersion: vi.fn(),
        setDocumentStatus: vi.fn(),
        archivePublishedVersions: vi.fn(),
        softDeleteDocument: vi.fn(),
      },
      counters: {
        ensureCounterGroup: vi.fn(),
        nextCounterValue: vi.fn(),
        nextScopedCounterValue: vi.fn(),
      },
    },
    queries: {
      collections: {
        getAllCollections: vi.fn(),
        getCollectionByPath,
        getCollectionById: vi.fn(),
      },
      documents: {
        getDocumentById,
        getCurrentVersionMetadata: vi.fn(),
        getDocumentByPath,
        getDocumentByVersion,
        getDocumentsByVersionIds: vi.fn(),
        getDocumentsByDocumentIds,
        getDocumentHistory,
        getPublishedVersion: vi.fn(),
        getPublishedDocumentIds: vi.fn(),
        getDocumentCountsByStatus: vi.fn(),
        findDocuments,
        getTreeSubtree,
        getTreeAncestors,
        getTreeParent: vi.fn(async () => ({ placed: false, parentDocumentId: null })),
      },
    },
  } satisfies IDbAdapter

  return {
    db,
    findDocuments,
    getDocumentById,
    getDocumentByPath,
    getDocumentByVersion,
    getDocumentHistory,
    getDocumentsByDocumentIds,
    getTreeSubtree,
  }
}

// ---------------------------------------------------------------------------
// Basic firing
// ---------------------------------------------------------------------------

describe('afterRead — basic firing', () => {
  it('fires once per returned source doc on find()', async () => {
    const hook = vi.fn()
    const posts = postsCollection(hook)
    const authors = authorsCollection()
    const { db, findDocuments } = makeAdapter()

    findDocuments.mockResolvedValueOnce({
      documents: [
        rawDoc('posts', 'p1', { title: 'A', author: null }),
        rawDoc('posts', 'p2', { title: 'B', author: null }),
      ],
      total: 2,
    })

    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: [posts, authors],
    })
    await client.collection('posts').find()

    expect(hook).toHaveBeenCalledTimes(2)
    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionPath: 'posts',
        doc: expect.objectContaining({ document_id: 'p1' }),
        readContext: expect.objectContaining({ visited: expect.any(Set) }),
      })
    )
  })

  it('fires on findById, findByPath, findOne', async () => {
    const hook = vi.fn()
    const posts = postsCollection(hook)
    const authors = authorsCollection()
    const { db, getDocumentById, getDocumentByPath, findDocuments } = makeAdapter()

    getDocumentById.mockResolvedValueOnce(rawDoc('posts', 'p1', { title: 'A' }))
    await createBylineClient({ db, requestContext: superAdmin, collections: [posts, authors] })
      .collection('posts')
      .findById('p1')
    expect(hook).toHaveBeenCalledTimes(1)

    hook.mockClear()
    getDocumentByPath.mockResolvedValueOnce(rawDoc('posts', 'p2', { title: 'B' }))
    await createBylineClient({ db, requestContext: superAdmin, collections: [posts, authors] })
      .collection('posts')
      .findByPath('p2')
    expect(hook).toHaveBeenCalledTimes(1)

    hook.mockClear()
    findDocuments.mockResolvedValueOnce({
      documents: [rawDoc('posts', 'p3', { title: 'C' })],
      total: 1,
    })
    await createBylineClient({ db, requestContext: superAdmin, collections: [posts, authors] })
      .collection('posts')
      .findOne()
    expect(hook).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when the collection has no afterRead hook', async () => {
    const posts = postsCollection()
    const authors = authorsCollection()
    const { db, getDocumentById } = makeAdapter()
    getDocumentById.mockResolvedValueOnce(rawDoc('posts', 'p1', { title: 'A' }))

    await expect(
      createBylineClient({ db, requestContext: superAdmin, collections: [posts, authors] })
        .collection('posts')
        .findById('p1')
    ).resolves.toMatchObject({ id: 'p1', fields: { title: 'A' } })
  })
})

// ---------------------------------------------------------------------------
// Mutation
// ---------------------------------------------------------------------------

describe('afterRead — mutation', () => {
  it('mutation to doc.fields propagates into the shaped ClientDocument', async () => {
    const hook = vi.fn((ctx: any) => {
      ctx.doc.fields.computed = `${ctx.doc.fields.title}!`
    })
    const posts = postsCollection(hook)
    const authors = authorsCollection()
    const { db, getDocumentById } = makeAdapter()
    getDocumentById.mockResolvedValueOnce(rawDoc('posts', 'p1', { title: 'Hello' }))

    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: [posts, authors],
    })
    const doc = await client.collection('posts').findById('p1')

    expect(doc?.fields.title).toBe('Hello')
    expect(doc?.fields.computed).toBe('Hello!')
  })

  it('can redact a field (field masking pattern)', async () => {
    const hook = vi.fn((ctx: any) => {
      delete ctx.doc.fields.title
    })
    const posts = postsCollection(hook)
    const authors = authorsCollection()
    const { db, getDocumentById } = makeAdapter()
    getDocumentById.mockResolvedValueOnce(rawDoc('posts', 'p1', { title: 'Secret' }))

    const doc = await createBylineClient({
      db,
      requestContext: superAdmin,
      collections: [posts, authors],
    })
      .collection('posts')
      .findById('p1')

    expect(doc?.fields).not.toHaveProperty('title')
  })

  it('receives the operation-scoped actor for ordinary reads', async () => {
    const requestContext = createSuperAdminContext({ id: 'ordinary-reader' })
    const hook = vi.fn((ctx: any) => {
      if (ctx.requestContext.actor?.id !== 'ordinary-reader') delete ctx.doc.fields.secret
    })
    const { db, getDocumentById } = makeAdapter()
    getDocumentById.mockResolvedValueOnce(rawDoc('posts', 'p1', { secret: 'visible' }))

    const doc = await createBylineClient({
      db,
      requestContext,
      collections: [postsCollection(hook), authorsCollection()],
    })
      .collection('posts')
      .findById('p1')

    expect(doc?.fields.secret).toBe('visible')
    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({
        requestContext: expect.objectContaining({
          requestId: requestContext.requestId,
          readMode: 'published',
        }),
      })
    )
  })
})

// ---------------------------------------------------------------------------
// Populate interaction
// ---------------------------------------------------------------------------

describe('afterRead — populate interaction', () => {
  it('fires for each populated target (one per unique target)', async () => {
    const postsHook = vi.fn()
    const authorsHook = vi.fn()
    const posts = postsCollection(postsHook)
    const authors = authorsCollection(authorsHook)

    const authorDoc = rawDoc('authors', 'a1', { name: 'Nora' })
    const { db, findDocuments } = makeAdapter({ authors: { a1: authorDoc } })
    findDocuments.mockResolvedValueOnce({
      documents: [
        rawDoc('posts', 'p1', {
          title: 'T',
          author: { targetDocumentId: 'a1', targetCollectionId: 'authors' },
        }),
      ],
      total: 1,
    })

    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: [posts, authors],
    })
    await client.collection('posts').find({ populate: { author: true } })

    expect(postsHook).toHaveBeenCalledTimes(1)
    expect(authorsHook).toHaveBeenCalledTimes(1)
    expect(authorsHook).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionPath: 'authors',
        doc: expect.objectContaining({ document_id: 'a1' }),
      })
    )
  })

  it('source doc hook sees the populated tree', async () => {
    let observedAuthor: any
    const postsHook = vi.fn((ctx: any) => {
      observedAuthor = JSON.parse(JSON.stringify(ctx.doc.fields.author))
    })
    const posts = postsCollection(postsHook)
    const authors = authorsCollection()

    const authorDoc = rawDoc('authors', 'a1', { name: 'Nora' })
    const { db, findDocuments } = makeAdapter({ authors: { a1: authorDoc } })
    findDocuments.mockResolvedValueOnce({
      documents: [
        rawDoc('posts', 'p1', {
          title: 'T',
          author: { targetDocumentId: 'a1', targetCollectionId: 'authors' },
        }),
      ],
      total: 1,
    })

    await createBylineClient({ db, requestContext: superAdmin, collections: [posts, authors] })
      .collection('posts')
      .find({ populate: { author: true } })

    // After populate, the author leaf is a populated envelope, not a raw ref.
    expect(observedAuthor?._resolved).toBe(true)
    expect(observedAuthor?.document?.document_id).toBe('a1')
  })

  it('passes the actor to populated-target redaction', async () => {
    const authorsHook = vi.fn((ctx: any) => {
      if (ctx.requestContext.actor?.id !== 'allowed') delete ctx.doc.fields.privateName
    })
    const authorDoc = rawDoc('authors', 'a1', { name: 'Nora', privateName: 'private' })
    const { db, findDocuments } = makeAdapter({ authors: { a1: authorDoc } })
    findDocuments.mockResolvedValueOnce({
      documents: [
        rawDoc('posts', 'p1', {
          title: 'T',
          author: { targetDocumentId: 'a1', targetCollectionId: 'authors' },
        }),
      ],
      total: 1,
    })

    const result = await createBylineClient({
      db,
      requestContext: createSuperAdminContext({ id: 'denied' }),
      collections: [postsCollection(), authorsCollection(authorsHook)],
    })
      .collection('posts')
      .find({ populate: { author: true } })

    expect((result.docs[0]?.fields.author as any).document.fields).not.toHaveProperty('privateName')
    expect(authorsHook.mock.calls[0]?.[0].requestContext.actor.id).toBe('denied')
  })
})

describe('afterRead — materialization paths', () => {
  const actorRedaction = vi.fn((ctx: any) => {
    if (ctx.requestContext.actor?.id === 'limited') delete ctx.doc.fields.secret
  })

  it('redacts historical versions and runs rich-text population first', async () => {
    let hookSawRefreshed = false
    const hook = vi.fn((ctx: any) => {
      hookSawRefreshed = ctx.doc.fields.body?.refreshed === true
      actorRedaction(ctx)
    })
    const posts: CollectionDefinition = {
      ...postsCollection(hook),
      fields: [
        { name: 'title', type: 'text', label: 'Title' },
        {
          name: 'body',
          type: 'richText',
          label: 'Body',
          populateRelationsOnRead: true,
        },
        { name: 'secret', type: 'text', label: 'Secret' },
      ],
    }
    const historical = rawDoc('posts', 'p1', {
      title: 'Old',
      body: { root: { children: [] } },
      secret: 'hidden',
    })
    const { db, getDocumentHistory } = makeAdapter()
    getDocumentHistory.mockResolvedValueOnce({
      documents: [historical],
      meta: { total: 1, page: 1, page_size: 20, total_pages: 1, order: 'updated_at', desc: true },
    })
    const richTextPopulate = vi.fn(async ({ value }: any) => {
      value.refreshed = true
    })

    const result = await createBylineClient({
      db,
      requestContext: createSuperAdminContext({ id: 'limited' }),
      collections: [posts],
      richTextPopulate,
    })
      .collection('posts')
      .history('p1')

    expect(result.docs[0]?.fields).not.toHaveProperty('secret')
    expect(result.docs[0]?.fields.body.refreshed).toBe(true)
    expect(hookSawRefreshed).toBe(true)
    expect(getDocumentHistory).toHaveBeenCalledWith(expect.objectContaining({ filters: undefined }))
  })

  it('redacts tree hydration after rich-text population', async () => {
    let hookSawRefreshed = false
    const hook = vi.fn((ctx: any) => {
      hookSawRefreshed = ctx.doc.fields.body?.refreshed === true
      actorRedaction(ctx)
    })
    const posts: CollectionDefinition = {
      ...postsCollection(hook),
      tree: true,
      fields: [
        { name: 'title', type: 'text', label: 'Title' },
        {
          name: 'body',
          type: 'richText',
          label: 'Body',
          populateRelationsOnRead: true,
        },
        { name: 'secret', type: 'text', label: 'Secret' },
      ],
    }
    const treeDoc = rawDoc('posts', 'p1', {
      title: 'Tree',
      body: { root: { children: [] } },
      secret: 'hidden',
    })
    const { db, getTreeSubtree } = makeAdapter({ posts: { p1: treeDoc } })
    getTreeSubtree.mockResolvedValueOnce([
      { document_id: 'p1', parent_document_id: null, depth: 0, order_key: 'a' },
    ])

    const result = await createBylineClient({
      db,
      requestContext: createSuperAdminContext({ id: 'limited' }),
      collections: [posts],
      richTextPopulate: vi.fn(async ({ value }: any) => {
        value.refreshed = true
      }),
    })
      .collection('posts')
      .getSubtree()

    expect(result[0]?.document.fields).not.toHaveProperty('secret')
    expect(result[0]?.document.fields.body.refreshed).toBe(true)
    expect(hookSawRefreshed).toBe(true)
  })

  it('redacts hydrated search documents for the operation actor', async () => {
    const posts: CollectionDefinition = {
      ...postsCollection(actorRedaction),
      search: { body: ['title'] },
      fields: [
        { name: 'title', type: 'text', label: 'Title' },
        { name: 'secret', type: 'text', label: 'Secret' },
      ],
    }
    const { db, findDocuments } = makeAdapter()
    findDocuments.mockResolvedValueOnce({
      documents: [rawDoc('posts', 'p1', { title: 'Hit', secret: 'hidden' })],
      total: 1,
    })
    const search = vi.fn().mockResolvedValue({
      hits: [
        {
          collectionPath: 'posts',
          documentId: 'p1',
          locale: 'en',
          title: 'Hit',
          path: 'hit',
          score: 1,
        },
      ],
      total: 1,
    })

    const result = await createBylineClient({
      db,
      requestContext: createSuperAdminContext({ id: 'limited' }),
      collections: [posts],
      search: { capabilities: {}, upsert: vi.fn(), remove: vi.fn(), search } as any,
    })
      .collection('posts')
      .search({ query: 'hit', hydrate: true })

    expect(result.hits[0]?.document?.fields).not.toHaveProperty('secret')
    expect(actorRedaction.mock.calls.at(-1)?.[0].requestContext.actor.id).toBe('limited')
  })
})

// ---------------------------------------------------------------------------
// A→B→A recursion safety
// ---------------------------------------------------------------------------

describe('afterRead — A→B→A safety', () => {
  it('processes the same materialized object only once per ReadContext', async () => {
    const postsHook = vi.fn()
    const posts = postsCollection(postsHook)
    const authors = authorsCollection()
    const { db, getDocumentById } = makeAdapter()
    getDocumentById.mockResolvedValue(rawDoc('posts', 'p1', { title: 'A' }))

    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: [posts, authors],
    })
    const ctx = createReadContext()

    await client.collection('posts').findById('p1', { _readContext: ctx })
    await client.collection('posts').findById('p1', { _readContext: ctx })

    expect(postsHook).toHaveBeenCalledTimes(1)
  })

  it('fresh ReadContext per top-level call fires the hook each time', async () => {
    const postsHook = vi.fn()
    const posts = postsCollection(postsHook)
    const authors = authorsCollection()
    const { db, getDocumentById } = makeAdapter()
    getDocumentById.mockResolvedValue(rawDoc('posts', 'p1', { title: 'A' }))

    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: [posts, authors],
    })
    await client.collection('posts').findById('p1')
    await client.collection('posts').findById('p1')

    expect(postsHook).toHaveBeenCalledTimes(2)
  })

  it('reruns redaction for fresh raw objects with identical read metadata', async () => {
    const postsHook = vi.fn((ctx: any) => delete ctx.doc.fields.secret)
    const { db, getDocumentById } = makeAdapter()
    getDocumentById.mockImplementation(async () =>
      rawDoc('posts', 'p1', { title: 'A', secret: 'hidden' })
    )
    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: [postsCollection(postsHook), authorsCollection()],
    })
    const ctx = createReadContext()

    const first = await client.collection('posts').findById('p1', { _readContext: ctx })
    const second = await client.collection('posts').findById('p1', { _readContext: ctx })

    expect(postsHook).toHaveBeenCalledTimes(2)
    expect(first?.fields).not.toHaveProperty('secret')
    expect(second?.fields).not.toHaveProperty('secret')
  })

  it('does not reprocess one object when later reads use different metadata', async () => {
    const postsHook = vi.fn()
    const posts = postsCollection(postsHook)
    const authors = authorsCollection()
    const { db, getDocumentById } = makeAdapter()
    getDocumentById.mockResolvedValue(rawDoc('posts', 'p1', { title: 'A', author: null }))
    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: [posts, authors],
    })
    const ctx = createReadContext()

    await client.collection('posts').findById('p1', { _readContext: ctx })
    await client.collection('posts').findById('p1', {
      _readContext: ctx,
      status: 'any',
      locale: 'fr',
      select: ['title'],
      populate: true,
    })

    expect(postsHook).toHaveBeenCalledTimes(1)
  })

  it('fails closed on A→B→A without exposing A and recovers after cleanup', async () => {
    let recurse = true
    let observedSensitive: unknown = 'not-returned'
    let cycleError: unknown
    const postsHook = vi.fn(async (ctx: any) => {
      if (recurse) {
        await client.collection('authors').findById('a1', { _readContext: ctx.readContext })
      }
      delete ctx.doc.fields.secret
    })
    const authorsHook = vi.fn(async (ctx: any) => {
      if (!recurse) return
      try {
        const activeA = await client
          .collection('posts')
          .findById('p1', { _readContext: ctx.readContext })
        observedSensitive = activeA?.fields.secret
      } catch (error) {
        cycleError = error
        throw error
      }
    })
    const { db, getDocumentById } = makeAdapter()
    getDocumentById.mockImplementation(async (p: any) => {
      if (p.document_id === 'p1') {
        return rawDoc('posts', 'p1', { title: 'T', secret: 'sensitive' })
      }
      if (p.document_id === 'a1') return rawDoc('authors', 'a1', { name: 'Nora' })
      return null
    })

    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: [postsCollection(postsHook), authorsCollection(authorsHook)],
    })
    const readContext = createReadContext()

    await expect(
      client.collection('posts').findById('p1', { _readContext: readContext })
    ).rejects.toMatchObject({
      code: ErrorCodes.READ_RECURSION,
      details: {
        collectionPath: 'posts',
        documentId: 'p1',
        documentVersionId: 'ver:p1',
      },
    })

    expect(observedSensitive).toBe('not-returned')
    expect(cycleError).toMatchObject({ code: ErrorCodes.READ_RECURSION })

    // Every active key is removed by the unwinding finally blocks. Reusing the
    // same ReadContext after disabling recursion must run and redact normally.
    recurse = false
    const recovered = await client.collection('posts').findById('p1', { _readContext: readContext })

    expect(recovered?.fields).not.toHaveProperty('secret')
    expect(postsHook).toHaveBeenCalledTimes(2)
    expect(authorsHook).toHaveBeenCalledTimes(1)
    expect(getDocumentById).toHaveBeenCalledTimes(4)
  })

  it('keeps the afterRead recursion guard when beforeRead threads a scoped context', async () => {
    let observedSensitive: unknown = 'not-returned'
    let cycleError: unknown
    const postsHook = vi.fn(async (ctx: any) => {
      await client.collection('authors').findById('a1', { _readContext: ctx.readContext })
      delete ctx.doc.fields.secret
    })
    const authors: CollectionDefinition = {
      ...authorsCollection(),
      hooks: {
        beforeRead: async ({ readContext: scoped }) => {
          try {
            const activeA = await client
              .collection('posts')
              .findById('p1', { _readContext: scoped })
            observedSensitive = activeA?.fields.secret
          } catch (error) {
            cycleError = error
            throw error
          }
        },
      },
    }
    const { db, getDocumentById } = makeAdapter()
    getDocumentById.mockImplementation(async (params: any) => {
      if (params.document_id === 'p1') {
        return rawDoc('posts', 'p1', { title: 'T', secret: 'sensitive' })
      }
      if (params.document_id === 'a1') return rawDoc('authors', 'a1', { name: 'Nora' })
      return null
    })
    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: [postsCollection(postsHook), authors],
    })
    const readContext = createReadContext()

    await expect(
      client.collection('posts').findById('p1', { _readContext: readContext })
    ).rejects.toMatchObject({
      code: ErrorCodes.READ_RECURSION,
    })

    expect(observedSensitive).toBe('not-returned')
    expect(cycleError).toMatchObject({
      message: "afterRead recursion blocked for active version 'ver:p1'",
      details: {
        collectionPath: 'posts',
        documentId: 'p1',
        documentVersionId: 'ver:p1',
      },
    })
    expect(postsHook).toHaveBeenCalledOnce()
    expect(getDocumentById).toHaveBeenCalledTimes(2)
  })

  it('does not mark a materialized object complete when a hook throws', async () => {
    let attempts = 0
    const hook = vi.fn((ctx: any) => {
      attempts++
      if (attempts === 1) throw new Error('redaction failed')
      delete ctx.doc.fields.secret
    })
    const shared = rawDoc('posts', 'p1', { title: 'A', secret: 'hidden' })
    const { db, getDocumentById } = makeAdapter()
    getDocumentById.mockResolvedValue(shared)
    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: [postsCollection(hook), authorsCollection()],
    })
    const ctx = createReadContext()

    await expect(client.collection('posts').findById('p1', { _readContext: ctx })).rejects.toThrow(
      'redaction failed'
    )
    const retried = await client.collection('posts').findById('p1', { _readContext: ctx })

    expect(hook).toHaveBeenCalledTimes(2)
    expect(retried?.fields).not.toHaveProperty('secret')
  })
})

// ---------------------------------------------------------------------------
// Array-of-hooks
// ---------------------------------------------------------------------------

describe('afterRead — array of hook functions', () => {
  it('runs sequentially, mutations visible to later hooks', async () => {
    const order: string[] = []
    const posts: CollectionDefinition = {
      path: 'posts',
      labels: { singular: 'Post', plural: 'Posts' },
      fields: [{ name: 'title', type: 'text', label: 'Title' }],
      hooks: {
        afterRead: [
          (ctx: any) => {
            order.push('first')
            ctx.doc.fields.stage = 1
          },
          (ctx: any) => {
            order.push('second')
            ctx.doc.fields.stageSeenByLater = ctx.doc.fields.stage
          },
        ],
      },
    }
    const { db, getDocumentById } = makeAdapter()
    getDocumentById.mockResolvedValueOnce(rawDoc('posts', 'p1', { title: 'A' }))

    const doc = await createBylineClient({ db, requestContext: superAdmin, collections: [posts] })
      .collection('posts')
      .findById('p1')

    expect(order).toEqual(['first', 'second'])
    expect(doc?.fields.stage).toBe(1)
    expect(doc?.fields.stageSeenByLater).toBe(1)
  })
})
