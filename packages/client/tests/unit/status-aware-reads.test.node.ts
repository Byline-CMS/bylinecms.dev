/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition, IDbAdapter } from '@byline/core'
import { describe, expect, it, vi } from 'vitest'

import { createBylineClient } from '../../src/index.js'

// ---------------------------------------------------------------------------
// Fixtures — two collections so we can exercise populate+readMode too.
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
  fields: [{ name: 'name', type: 'text', label: 'Name' }],
}

const allCollections = [postsCollection, authorsCollection]

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

function makeAdapter() {
  const getCollectionByPath = vi.fn(async (path: string) => ({ id: path, path }))
  const findDocuments = vi.fn(async () => ({ documents: [], total: 0 }))
  const getDocumentById = vi.fn(async () => null)
  const getDocumentByPath = vi.fn(async () => null)
  const getDocumentsByDocumentIds = vi.fn(async () => [])

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
// Default: 'published' mode
// ---------------------------------------------------------------------------

describe("CollectionHandle defaults to readMode: 'published'", () => {
  it('passes readMode: "published" to findDocuments by default', async () => {
    const { db, findDocuments } = makeAdapter()
    const client = createBylineClient({ db, collections: allCollections })

    await client.collection('posts').find()

    expect(findDocuments).toHaveBeenCalledWith(expect.objectContaining({ readMode: 'published' }))
  })

  it('passes readMode: "published" to getDocumentById by default', async () => {
    const { db, getDocumentById } = makeAdapter()
    const client = createBylineClient({ db, collections: allCollections })

    await client.collection('posts').findById('p1')

    expect(getDocumentById).toHaveBeenCalledWith(expect.objectContaining({ readMode: 'published' }))
  })

  it('passes readMode: "published" to getDocumentByPath by default', async () => {
    const { db, getDocumentByPath } = makeAdapter()
    const client = createBylineClient({ db, collections: allCollections })

    await client.collection('posts').findByPath('hello')

    expect(getDocumentByPath).toHaveBeenCalledWith(
      expect.objectContaining({ readMode: 'published' })
    )
  })
})

// ---------------------------------------------------------------------------
// Explicit 'any' override
// ---------------------------------------------------------------------------

describe("status: 'any' override", () => {
  it('forwards readMode: "any" to the adapter on find', async () => {
    const { db, findDocuments } = makeAdapter()
    const client = createBylineClient({ db, collections: allCollections })

    await client.collection('posts').find({ status: 'any' })

    expect(findDocuments).toHaveBeenCalledWith(expect.objectContaining({ readMode: 'any' }))
  })

  it('forwards readMode: "any" to the adapter on findById', async () => {
    const { db, getDocumentById } = makeAdapter()
    const client = createBylineClient({ db, collections: allCollections })

    await client.collection('posts').findById('p1', { status: 'any' })

    expect(getDocumentById).toHaveBeenCalledWith(expect.objectContaining({ readMode: 'any' }))
  })

  it('forwards readMode: "any" to the adapter on findByPath', async () => {
    const { db, getDocumentByPath } = makeAdapter()
    const client = createBylineClient({ db, collections: allCollections })

    await client.collection('posts').findByPath('hello', { status: 'any' })

    expect(getDocumentByPath).toHaveBeenCalledWith(expect.objectContaining({ readMode: 'any' }))
  })

  it('findOne forwards the status option through to find', async () => {
    const { db, findDocuments } = makeAdapter()
    const client = createBylineClient({ db, collections: allCollections })

    await client.collection('posts').findOne({ status: 'any' })

    expect(findDocuments).toHaveBeenCalledWith(expect.objectContaining({ readMode: 'any' }))
  })
})

// ---------------------------------------------------------------------------
// status is distinct from where.status
// ---------------------------------------------------------------------------

describe('top-level status is distinct from where.status', () => {
  it('passes where.status as the exact-filter status, and client default as readMode', async () => {
    const { db, findDocuments } = makeAdapter()
    const client = createBylineClient({ db, collections: allCollections })

    await client.collection('posts').find({ where: { status: 'draft' } })

    expect(findDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'draft', readMode: 'published' })
    )
  })
})

// ---------------------------------------------------------------------------
// Populate forwards readMode
// ---------------------------------------------------------------------------

describe('populate forwards readMode to the batch fetch', () => {
  it('published mode asks the adapter for published targets', async () => {
    const { db, findDocuments, getDocumentsByDocumentIds } = makeAdapter()
    findDocuments.mockResolvedValueOnce({
      documents: [
        rawDoc('posts', 'p1', {
          author: { target_document_id: 'a1', target_collection_id: 'authors' },
        }),
      ],
      total: 1,
    })

    const client = createBylineClient({ db, collections: allCollections })
    await client.collection('posts').find({ populate: { author: true } })

    expect(getDocumentsByDocumentIds).toHaveBeenCalledWith(
      expect.objectContaining({
        collection_id: 'authors',
        document_ids: ['a1'],
        readMode: 'published',
      })
    )
  })

  it('any mode asks the adapter for the current (latest) target', async () => {
    const { db, findDocuments, getDocumentsByDocumentIds } = makeAdapter()
    findDocuments.mockResolvedValueOnce({
      documents: [
        rawDoc('posts', 'p1', {
          author: { target_document_id: 'a1', target_collection_id: 'authors' },
        }),
      ],
      total: 1,
    })

    const client = createBylineClient({ db, collections: allCollections })
    await client.collection('posts').find({ populate: { author: true }, status: 'any' })

    expect(getDocumentsByDocumentIds).toHaveBeenCalledWith(
      expect.objectContaining({ readMode: 'any' })
    )
  })
})
