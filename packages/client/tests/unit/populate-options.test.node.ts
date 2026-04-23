/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createSuperAdminContext } from '@byline/auth'
import type { CollectionDefinition, IDbAdapter } from '@byline/core'
import { describe, expect, it, vi } from 'vitest'

import { createBylineClient } from '../../src/index.js'

const superAdmin = createSuperAdminContext({ id: 'test-super-admin' })

// ---------------------------------------------------------------------------
// Fixtures — three collections to exercise populate plumbing end-to-end.
// The CollectionHandle invokes `populateDocuments` against a mock adapter;
// we assert on the mock's call log rather than on any DB state.
// ---------------------------------------------------------------------------

const postsCollection: CollectionDefinition = {
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
}

const authorsCollection: CollectionDefinition = {
  path: 'authors',
  labels: { singular: 'Author', plural: 'Authors' },
  fields: [
    { name: 'name', type: 'text', label: 'Name' },
    {
      name: 'employer',
      type: 'relation',
      label: 'Employer',
      targetCollection: 'orgs',
      optional: true,
    },
  ],
}

const orgsCollection: CollectionDefinition = {
  path: 'orgs',
  labels: { singular: 'Org', plural: 'Orgs' },
  fields: [{ name: 'name', type: 'text', label: 'Name' }],
}

const allCollections = [postsCollection, authorsCollection, orgsCollection]

// ---------------------------------------------------------------------------
// Mock adapter — returns fixture docs, records all calls.
// ---------------------------------------------------------------------------

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
  const findDocuments = vi.fn(
    async (_params: any): Promise<{ documents: any[]; total: number }> => ({
      documents: [],
      total: 0,
    })
  )
  const getDocumentById = vi.fn(async (_params: any) => null)
  const getDocumentByPath = vi.fn(async (_params: any) => null)
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
// find() — populate + depth
// ---------------------------------------------------------------------------

describe('CollectionHandle.find populate integration', () => {
  it('does not call getDocumentsByDocumentIds when populate is omitted', async () => {
    const { db, findDocuments, getDocumentsByDocumentIds } = makeAdapter()
    findDocuments.mockResolvedValueOnce({
      documents: [rawDoc('posts', 'p1', { title: 'T', author: null })],
      total: 1,
    })

    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: allCollections,
    })
    await client.collection('posts').find()

    expect(getDocumentsByDocumentIds).not.toHaveBeenCalled()
  })

  it('invokes populate for each requested relation and shapes nested docs', async () => {
    const author = rawDoc('authors', 'a1', { name: 'Nora' })
    const { db, findDocuments, getDocumentsByDocumentIds } = makeAdapter({
      authors: { a1: author },
    })

    findDocuments.mockResolvedValueOnce({
      documents: [
        rawDoc('posts', 'p1', {
          title: 'Hello',
          author: { target_document_id: 'a1', target_collection_id: 'authors' },
        }),
      ],
      total: 1,
    })

    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: allCollections,
    })
    const result = await client.collection('posts').find({ populate: { author: true }, depth: 1 })

    expect(getDocumentsByDocumentIds).toHaveBeenCalledTimes(1)
    expect(getDocumentsByDocumentIds).toHaveBeenCalledWith(
      expect.objectContaining({ collection_id: 'authors', document_ids: ['a1'] })
    )

    const populated = result.docs[0]?.fields.author as any
    // Populated leaf is an envelope — target_*_id preserved, _resolved flag set,
    // and the shaped ClientDocument lives under `document`.
    expect(populated).toEqual(
      expect.objectContaining({
        target_document_id: 'a1',
        target_collection_id: 'authors',
        _resolved: true,
        document: expect.objectContaining({
          id: 'a1',
          versionId: 'ver:a1',
          fields: expect.objectContaining({ name: 'Nora' }),
        }),
      })
    )
  })

  it('depth: 0 skips population even when populate is set', async () => {
    const { db, findDocuments, getDocumentsByDocumentIds } = makeAdapter()
    findDocuments.mockResolvedValueOnce({
      documents: [
        rawDoc('posts', 'p1', {
          author: { target_document_id: 'a1', target_collection_id: 'authors' },
        }),
      ],
      total: 1,
    })

    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: allCollections,
    })
    await client.collection('posts').find({ populate: { author: true }, depth: 0 })

    expect(getDocumentsByDocumentIds).not.toHaveBeenCalled()
  })

  it('populate: true recurses across depth: 2 with one query per target per level', async () => {
    const org = rawDoc('orgs', 'o1', { name: 'Acme' })
    const author = rawDoc('authors', 'a1', {
      name: 'Nora',
      employer: { target_document_id: 'o1', target_collection_id: 'orgs' },
    })
    const { db, findDocuments, getDocumentsByDocumentIds } = makeAdapter({
      authors: { a1: author },
      orgs: { o1: org },
    })
    findDocuments.mockResolvedValueOnce({
      documents: [
        rawDoc('posts', 'p1', {
          title: 'Hello',
          author: { target_document_id: 'a1', target_collection_id: 'authors' },
        }),
      ],
      total: 1,
    })

    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: allCollections,
    })
    const result = await client.collection('posts').find({ populate: true, depth: 2 })

    expect(getDocumentsByDocumentIds).toHaveBeenCalledTimes(2)
    const populatedAuthor = result.docs[0]?.fields.author as any
    expect(populatedAuthor?._resolved).toBe(true)
    expect(populatedAuthor?.document?.id).toBe('a1')
    // The nested employer leaf is also wrapped in an envelope whose
    // `document` is the shaped target.
    expect(populatedAuthor?.document?.fields?.employer?._resolved).toBe(true)
    expect(populatedAuthor?.document?.fields?.employer?.document?.id).toBe('o1')
  })

  it('nested select forwards to batch fetch and unions with the target first text field', async () => {
    const author = rawDoc('authors', 'a1', { name: 'Nora' })
    const { db, findDocuments, getDocumentsByDocumentIds } = makeAdapter({
      authors: { a1: author },
    })
    findDocuments.mockResolvedValueOnce({
      documents: [
        rawDoc('posts', 'p1', {
          author: { target_document_id: 'a1', target_collection_id: 'authors' },
        }),
      ],
      total: 1,
    })

    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: allCollections,
    })
    await client.collection('posts').find({ populate: { author: { select: ['employer'] } } })

    expect(getDocumentsByDocumentIds).toHaveBeenCalledWith(
      expect.objectContaining({
        collection_id: 'authors',
        fields: expect.arrayContaining(['employer', 'name']),
      })
    )
  })
})

// ---------------------------------------------------------------------------
// findById() — populate + shape-deep
// ---------------------------------------------------------------------------

describe('CollectionHandle.findById populate integration', () => {
  it('populates a single relation and returns a shaped top-level doc', async () => {
    const author = rawDoc('authors', 'a1', { name: 'Nora' })
    const { db, getDocumentById, getDocumentsByDocumentIds } = makeAdapter({
      authors: { a1: author },
    })
    getDocumentById.mockResolvedValueOnce(
      rawDoc('posts', 'p1', {
        title: 'Hello',
        author: { target_document_id: 'a1', target_collection_id: 'authors' },
      })
    )

    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: allCollections,
    })
    const doc = await client.collection('posts').findById('p1', { populate: { author: true } })

    expect(getDocumentsByDocumentIds).toHaveBeenCalledTimes(1)
    expect(doc?.id).toBe('p1')
    expect((doc?.fields.author as any)?._resolved).toBe(true)
    expect((doc?.fields.author as any)?.document?.id).toBe('a1')
  })

  it('select + populate trims before populate runs', async () => {
    const author = rawDoc('authors', 'a1', { name: 'Nora' })
    const { db, getDocumentById, getDocumentsByDocumentIds } = makeAdapter({
      authors: { a1: author },
    })
    getDocumentById.mockResolvedValueOnce(
      rawDoc('posts', 'p1', {
        title: 'Hello',
        author: { target_document_id: 'a1', target_collection_id: 'authors' },
      })
    )

    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: allCollections,
    })
    // Select excludes `author` → populate has nothing to resolve.
    const doc = await client
      .collection('posts')
      .findById('p1', { select: ['title'], populate: { author: true } })

    expect(getDocumentsByDocumentIds).not.toHaveBeenCalled()
    expect(doc?.fields).toEqual({ title: 'Hello' })
  })

  it('replaces a deleted target with an unresolved stub', async () => {
    const { db, getDocumentById } = makeAdapter({ authors: {} /* nothing */ })
    getDocumentById.mockResolvedValueOnce(
      rawDoc('posts', 'p1', {
        author: { target_document_id: 'gone', target_collection_id: 'authors' },
      })
    )

    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: allCollections,
    })
    const doc = await client.collection('posts').findById('p1', { populate: { author: true } })

    expect(doc?.fields.author).toEqual({
      target_document_id: 'gone',
      target_collection_id: 'authors',
      _resolved: false,
    })
  })
})

// ---------------------------------------------------------------------------
// findByPath() — populate
// ---------------------------------------------------------------------------

describe('CollectionHandle.findByPath populate integration', () => {
  it('populates when the path resolves', async () => {
    const author = rawDoc('authors', 'a1', { name: 'Nora' })
    const { db, getDocumentByPath, getDocumentsByDocumentIds } = makeAdapter({
      authors: { a1: author },
    })
    getDocumentByPath.mockResolvedValueOnce(
      rawDoc('posts', 'p1', {
        author: { target_document_id: 'a1', target_collection_id: 'authors' },
      })
    )

    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: allCollections,
    })
    const doc = await client.collection('posts').findByPath('p1', { populate: { author: true } })

    expect(getDocumentsByDocumentIds).toHaveBeenCalledTimes(1)
    expect((doc?.fields.author as any)?._resolved).toBe(true)
    expect((doc?.fields.author as any)?.document?.id).toBe('a1')
  })

  it('returns null when path is missing (no populate invocation)', async () => {
    const { db, getDocumentByPath, getDocumentsByDocumentIds } = makeAdapter()
    getDocumentByPath.mockResolvedValueOnce(null)

    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: allCollections,
    })
    const doc = await client
      .collection('posts')
      .findByPath('missing', { populate: { author: true } })

    expect(doc).toBeNull()
    expect(getDocumentsByDocumentIds).not.toHaveBeenCalled()
  })
})
