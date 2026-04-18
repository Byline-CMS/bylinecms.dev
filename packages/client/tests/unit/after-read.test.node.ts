/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition, IDbAdapter } from '@byline/core'
import { createReadContext } from '@byline/core'
import { describe, expect, it, vi } from 'vitest'

import { createBylineClient } from '../../src/index.js'

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
  const getDocumentsByDocumentIds = vi.fn(
    async (params: { collection_id: string; document_ids: string[] }) => {
      const bucket = fetchMap[params.collection_id] ?? {}
      return params.document_ids.map((id) => bucket[id]).filter(Boolean)
    }
  )

  const db = {
    commands: {
      collections: { create: vi.fn(), delete: vi.fn() },
      documents: {
        createDocumentVersion: vi.fn(),
        setDocumentStatus: vi.fn(),
        archivePublishedVersions: vi.fn(),
        softDeleteDocument: vi.fn(),
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
        getDocumentByVersion: vi.fn(),
        getDocumentsByVersionIds: vi.fn(),
        getDocumentsByDocumentIds,
        getDocumentHistory: vi.fn(),
        getPublishedVersion: vi.fn(),
        getPublishedDocumentIds: vi.fn(),
        getDocumentCountsByStatus: vi.fn(),
        findDocuments,
      },
    },
  } satisfies IDbAdapter

  return { db, findDocuments, getDocumentById, getDocumentByPath, getDocumentsByDocumentIds }
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

    const client = createBylineClient({ db, collections: [posts, authors] })
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
    await createBylineClient({ db, collections: [posts, authors] })
      .collection('posts')
      .findById('p1')
    expect(hook).toHaveBeenCalledTimes(1)

    hook.mockClear()
    getDocumentByPath.mockResolvedValueOnce(rawDoc('posts', 'p2', { title: 'B' }))
    await createBylineClient({ db, collections: [posts, authors] })
      .collection('posts')
      .findByPath('p2')
    expect(hook).toHaveBeenCalledTimes(1)

    hook.mockClear()
    findDocuments.mockResolvedValueOnce({
      documents: [rawDoc('posts', 'p3', { title: 'C' })],
      total: 1,
    })
    await createBylineClient({ db, collections: [posts, authors] })
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
      createBylineClient({ db, collections: [posts, authors] })
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

    const client = createBylineClient({ db, collections: [posts, authors] })
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

    const doc = await createBylineClient({ db, collections: [posts, authors] })
      .collection('posts')
      .findById('p1')

    expect(doc?.fields).not.toHaveProperty('title')
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
          author: { target_document_id: 'a1', target_collection_id: 'authors' },
        }),
      ],
      total: 1,
    })

    const client = createBylineClient({ db, collections: [posts, authors] })
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
          author: { target_document_id: 'a1', target_collection_id: 'authors' },
        }),
      ],
      total: 1,
    })

    await createBylineClient({ db, collections: [posts, authors] })
      .collection('posts')
      .find({ populate: { author: true } })

    // After populate, the author leaf is a populated envelope, not a raw ref.
    expect(observedAuthor?._resolved).toBe(true)
    expect(observedAuthor?.document?.document_id).toBe('a1')
  })
})

// ---------------------------------------------------------------------------
// A→B→A recursion safety
// ---------------------------------------------------------------------------

describe('afterRead — A→B→A safety', () => {
  it('fires at most once per doc per ReadContext across nested reads', async () => {
    const postsHook = vi.fn()
    const posts = postsCollection(postsHook)
    const authors = authorsCollection()
    const { db, getDocumentById } = makeAdapter()
    getDocumentById.mockResolvedValue(rawDoc('posts', 'p1', { title: 'A' }))

    const client = createBylineClient({ db, collections: [posts, authors] })
    const ctx = createReadContext()

    // Two separate top-level calls sharing the same ReadContext — mimics
    // a hook re-entering the client API with { _readContext: ctx }.
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

    const client = createBylineClient({ db, collections: [posts, authors] })
    await client.collection('posts').findById('p1')
    await client.collection('posts').findById('p1')

    expect(postsHook).toHaveBeenCalledTimes(2)
  })

  it('A re-reads B from inside its own hook without re-firing A', async () => {
    let authorsHook: any
    const posts = postsCollection(async (ctx: any) => {
      // Hook on A performs its own read of B, threading the context.
      const b = await client
        .collection('authors')
        .findById(ctx.doc.fields.author.target_document_id, { _readContext: ctx.readContext })
      ctx.doc.fields.authorName = b?.fields.name
    })

    const authorsHookFn = vi.fn()
    const authors = authorsCollection(authorsHookFn)
    authorsHook = authorsHookFn

    const authorDoc = rawDoc('authors', 'a1', { name: 'Nora' })
    const { db, getDocumentById } = makeAdapter()
    // Two fetches: first for p1, then for a1 from inside the hook.
    getDocumentById.mockImplementation(async (p: any) => {
      if (p.document_id === 'p1') {
        return rawDoc('posts', 'p1', {
          title: 'T',
          author: { target_document_id: 'a1', target_collection_id: 'authors' },
        })
      }
      if (p.document_id === 'a1') {
        return authorDoc
      }
      return null
    })

    const client = createBylineClient({ db, collections: [posts, authors] })
    const result = await client.collection('posts').findById('p1')

    expect(result?.fields.authorName).toBe('Nora')
    // authors hook fired once (for the nested read).
    expect(authorsHook).toHaveBeenCalledTimes(1)
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

    const doc = await createBylineClient({ db, collections: [posts] })
      .collection('posts')
      .findById('p1')

    expect(order).toEqual(['first', 'second'])
    expect(doc?.fields.stage).toBe(1)
    expect(doc?.fields.stageSeenByLater).toBe(1)
  })
})
