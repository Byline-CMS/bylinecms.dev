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
// Fixtures
// ---------------------------------------------------------------------------

const postsCollection: CollectionDefinition = {
  path: 'posts',
  labels: { singular: 'Post', plural: 'Posts' },
  useAsPath: 'title',
  fields: [{ name: 'title', type: 'text', label: 'Title' }],
}

const allCollections = [postsCollection]

interface AdapterOverrides {
  currentStatus?: string
  currentVersionId?: string
  createReturn?: any
  existingDoc?: Record<string, any> | null
}

function makeAdapter(overrides: AdapterOverrides = {}) {
  const {
    currentStatus = 'draft',
    currentVersionId = 'ver:current',
    createReturn,
    existingDoc,
  } = overrides

  const getCollectionByPath = vi.fn(async (path: string) => ({ id: `col:${path}`, path }))

  const createDocumentVersion = vi.fn(
    async (_params: any) =>
      createReturn ?? {
        document: {
          id: 'ver:new',
          document_id: 'doc:new',
          document_version_id: 'ver:new',
        },
      }
  )
  const setDocumentStatus = vi.fn(async (_params: any) => {})
  const archivePublishedVersions = vi.fn(async (_params: any) => 1)
  const softDeleteDocument = vi.fn(async (_params: any) => 3)

  const getDocumentById = vi.fn(async (_params: any) =>
    existingDoc === undefined
      ? {
          document_id: 'doc:1',
          document_version_id: currentVersionId,
          path: 'original-path',
          status: currentStatus,
          fields: { title: 'Original' },
        }
      : existingDoc
  )

  const getCurrentVersionMetadata = vi.fn(async (_params: any) => ({
    document_version_id: currentVersionId,
    status: currentStatus,
    path: 'original-path',
  }))

  const db = {
    commands: {
      collections: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      documents: {
        createDocumentVersion,
        setDocumentStatus,
        archivePublishedVersions,
        softDeleteDocument,
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
        getCurrentVersionMetadata,
        getDocumentByPath: vi.fn(),
        getDocumentByVersion: vi.fn(),
        getDocumentsByVersionIds: vi.fn(),
        getDocumentsByDocumentIds: vi.fn(),
        getDocumentHistory: vi.fn(),
        getPublishedVersion: vi.fn(),
        getPublishedDocumentIds: vi.fn(),
        getDocumentCountsByStatus: vi.fn(),
        findDocuments: vi.fn(),
      },
    },
  } satisfies IDbAdapter

  return {
    db,
    createDocumentVersion,
    setDocumentStatus,
    archivePublishedVersions,
    softDeleteDocument,
    getDocumentById,
    getCurrentVersionMetadata,
  }
}

// ---------------------------------------------------------------------------
// create()
// ---------------------------------------------------------------------------

describe('CollectionHandle.create', () => {
  it('delegates to createDocumentVersion with action=create and the resolved collection id', async () => {
    const { db, createDocumentVersion } = makeAdapter()
    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: allCollections,
    })

    const result = await client
      .collection('posts')
      .create({ title: 'Hello' }, { locale: 'en', status: 'draft', path: 'hello' })

    expect(createDocumentVersion).toHaveBeenCalledTimes(1)
    expect(createDocumentVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionId: 'col:posts',
        action: 'create',
        documentData: expect.objectContaining({ title: 'Hello' }),
        path: 'hello',
        status: 'draft',
        locale: 'en',
      })
    )
    expect(result).toEqual({ documentId: 'doc:new', documentVersionId: 'ver:new' })
  })

  it('invokes beforeCreate and afterCreate hooks in order', async () => {
    const beforeCreate = vi.fn()
    const afterCreate = vi.fn()
    const collection: CollectionDefinition = {
      ...postsCollection,
      hooks: { beforeCreate, afterCreate },
    }
    const { db } = makeAdapter()
    const client = createBylineClient({ db, requestContext: superAdmin, collections: [collection] })

    await client.collection('posts').create({ title: 'Hook test' })

    expect(beforeCreate).toHaveBeenCalledTimes(1)
    expect(afterCreate).toHaveBeenCalledTimes(1)
    expect(beforeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: 'Hook test' }),
        collectionPath: 'posts',
      })
    )
    expect(afterCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionPath: 'posts',
        documentId: 'doc:new',
        documentVersionId: 'ver:new',
      })
    )
  })

  it('derives a path from the useAsPath source field when no override is supplied', async () => {
    const { db, createDocumentVersion } = makeAdapter()
    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: allCollections,
    })

    await client.collection('posts').create({ title: 'Hello World' })

    expect(createDocumentVersion).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'hello-world' })
    )
  })
})

// ---------------------------------------------------------------------------
// update()
// ---------------------------------------------------------------------------

describe('CollectionHandle.update', () => {
  it('fetches the current version and passes previousVersionId to createDocumentVersion', async () => {
    const { db, createDocumentVersion, getDocumentById } = makeAdapter({
      currentVersionId: 'ver:old',
    })
    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: allCollections,
    })

    await client.collection('posts').update('doc:1', { title: 'Updated', path: 'updated' })

    expect(getDocumentById).toHaveBeenCalledWith(
      expect.objectContaining({ collection_id: 'col:posts', document_id: 'doc:1' })
    )
    expect(createDocumentVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc:1',
        action: 'update',
        previousVersionId: 'ver:old',
        documentData: expect.objectContaining({ title: 'Updated' }),
      })
    )
  })

  it('invokes beforeUpdate with originalData derived from the fetched current version', async () => {
    const beforeUpdate = vi.fn()
    const collection: CollectionDefinition = {
      ...postsCollection,
      hooks: { beforeUpdate },
    }
    const { db } = makeAdapter({
      existingDoc: {
        document_id: 'doc:1',
        document_version_id: 'ver:old',
        path: 'original',
        status: 'draft',
        fields: { title: 'Before' },
      },
    })
    const client = createBylineClient({ db, requestContext: superAdmin, collections: [collection] })

    await client.collection('posts').update('doc:1', { title: 'After' })

    expect(beforeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: 'After' }),
        originalData: expect.objectContaining({ fields: { title: 'Before' } }),
        collectionPath: 'posts',
      })
    )
  })
})

// ---------------------------------------------------------------------------
// changeStatus()
// ---------------------------------------------------------------------------

describe('CollectionHandle.changeStatus', () => {
  it('validates the transition and mutates status in-place', async () => {
    const { db, setDocumentStatus, archivePublishedVersions } = makeAdapter({
      currentStatus: 'draft',
      currentVersionId: 'ver:current',
    })
    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: allCollections,
    })

    const result = await client.collection('posts').changeStatus('doc:1', 'published')

    expect(result).toEqual({ previousStatus: 'draft', newStatus: 'published' })
    expect(setDocumentStatus).toHaveBeenCalledWith({
      document_version_id: 'ver:current',
      status: 'published',
    })
    // Auto-archive runs when transitioning to published.
    expect(archivePublishedVersions).toHaveBeenCalledWith(
      expect.objectContaining({
        document_id: 'doc:1',
        excludeVersionId: 'ver:current',
      })
    )
  })

  it('does not auto-archive for non-published transitions', async () => {
    const { db, archivePublishedVersions } = makeAdapter({
      currentStatus: 'draft',
    })
    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: allCollections,
    })

    // draft → draft is a no-op but a valid transition (reset-to-first).
    // Use an invalid direction-sensitive path: draft → archived skipping published
    // is also invalid. Use the default 3-state workflow: archived ↔ published ↔ draft.
    // A safe valid transition: draft → published (archives), then we assert
    // a separate case: archived→archived or similar.
    // Simpler: verify that a draft→archived call rejects (invalid transition).
    await expect(
      client.collection('posts').changeStatus('doc:1', 'archived')
    ).rejects.toThrowError()

    expect(archivePublishedVersions).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// unpublish()
// ---------------------------------------------------------------------------

describe('CollectionHandle.unpublish', () => {
  it('archives published versions and returns the count', async () => {
    const { db, archivePublishedVersions } = makeAdapter()
    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: allCollections,
    })

    const result = await client.collection('posts').unpublish('doc:1')

    expect(archivePublishedVersions).toHaveBeenCalledWith({ document_id: 'doc:1' })
    expect(result).toEqual({ archivedCount: 1 })
  })
})

// ---------------------------------------------------------------------------
// delete()
// ---------------------------------------------------------------------------

describe('CollectionHandle.delete', () => {
  it('soft-deletes after verifying the document exists', async () => {
    const { db, softDeleteDocument, getDocumentById } = makeAdapter()
    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: allCollections,
    })

    const result = await client.collection('posts').delete('doc:1')

    expect(getDocumentById).toHaveBeenCalled()
    expect(softDeleteDocument).toHaveBeenCalledWith({ document_id: 'doc:1' })
    expect(result).toEqual({ deletedVersionCount: 3 })
  })

  it('throws ERR_NOT_FOUND when the document does not exist', async () => {
    const { db, softDeleteDocument } = makeAdapter({ existingDoc: null })
    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: allCollections,
    })

    await expect(client.collection('posts').delete('doc:missing')).rejects.toThrowError(
      /document not found/
    )
    expect(softDeleteDocument).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Logger fallback
// ---------------------------------------------------------------------------

describe('BylineClient logger fallback', () => {
  it('uses a silent logger when none is supplied and getLogger() is unset', async () => {
    const { db } = makeAdapter()
    // If this constructed successfully and the write call runs without
    // throwing a "logger not initialised" error, the fallback is working.
    const client = createBylineClient({
      db,
      requestContext: superAdmin,
      collections: allCollections,
    })
    await expect(client.collection('posts').create({ title: 'T' })).resolves.toEqual(
      expect.objectContaining({ documentId: 'doc:new' })
    )
  })
})
