/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it, vi } from 'vitest'

import {
  ConflictError,
  changeDocumentStatus,
  createDocument,
  DocumentNotFoundError,
  InvalidTransitionError,
  PatchApplicationError,
  unpublishDocument,
  updateDocument,
  updateDocumentWithPatches,
} from './document-lifecycle.js'
import type { CollectionDefinition, IDbAdapter } from '../@types/index.js'
import type { DocumentLifecycleContext } from './document-lifecycle.js'

// ---------------------------------------------------------------------------
// Fixtures / Helpers
// ---------------------------------------------------------------------------

const minimalCollection: CollectionDefinition = {
  path: 'articles',
  labels: { singular: 'Article', plural: 'Articles' },
  fields: [{ name: 'title', type: 'text', label: 'Title' }],
  workflow: {
    statuses: [
      { name: 'draft', label: 'Draft' },
      { name: 'published', label: 'Published' },
      { name: 'archived', label: 'Archived' },
    ],
  },
}

/** Build a mock IDbAdapter. Returns the adapter plus individual mock fns. */
function createMockDb() {
  const createDocumentVersion = vi.fn().mockResolvedValue({
    document: { id: 'ver-1', document_id: 'doc-1' },
    fieldCount: 3,
  })
  const setDocumentStatus = vi.fn().mockResolvedValue(undefined)
  const archivePublishedVersions = vi.fn().mockResolvedValue(0)
  const getDocumentById = vi.fn().mockResolvedValue(null)

  const db: IDbAdapter = {
    commands: {
      collections: {
        create: vi.fn(),
        delete: vi.fn(),
      },
      documents: {
        createDocumentVersion,
        setDocumentStatus,
        archivePublishedVersions,
      },
    },
    queries: {
      collections: {
        getAllCollections: vi.fn(),
        getCollectionByPath: vi.fn(),
        getCollectionById: vi.fn(),
      },
      documents: {
        getAllDocuments: vi.fn(),
        getDocumentsByBatch: vi.fn(),
        getDocumentsByPage: vi.fn(),
        getDocumentById,
        getDocumentByPath: vi.fn(),
        getDocumentByVersion: vi.fn(),
        getDocuments: vi.fn(),
        getDocumentHistory: vi.fn(),
        getPublishedVersion: vi.fn(),
      },
    },
  }

  return { db, createDocumentVersion, setDocumentStatus, archivePublishedVersions, getDocumentById }
}

function buildCtx(
  db: IDbAdapter,
  definition: CollectionDefinition = minimalCollection
): DocumentLifecycleContext {
  return {
    db,
    definition,
    collectionId: 'col-1',
    collectionPath: definition.path,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Document lifecycle service', () => {
  // -----------------------------------------------------------------------
  // createDocument
  // -----------------------------------------------------------------------
  describe('createDocument', () => {
    it('calls createDocumentVersion and returns IDs', async () => {
      const { db, createDocumentVersion } = createMockDb()
      const ctx = buildCtx(db)

      const result = await createDocument(ctx, {
        data: { title: 'Hello', path: 'hello' },
        locale: 'en',
      })

      expect(createDocumentVersion).toHaveBeenCalledOnce()
      expect(result.documentId).toBe('doc-1')
      expect(result.documentVersionId).toBe('ver-1')
    })

    it('invokes beforeCreate and afterCreate hooks in order', async () => {
      const callOrder: string[] = []

      const hooks = {
        beforeCreate: vi.fn(async () => {
          callOrder.push('before')
        }),
        afterCreate: vi.fn(async () => {
          callOrder.push('after')
        }),
      }

      const { db, createDocumentVersion } = createMockDb()
      createDocumentVersion.mockImplementation(async () => {
        callOrder.push('persist')
        return { document: { id: 'ver-1', document_id: 'doc-1' }, fieldCount: 1 }
      })

      const definition = { ...minimalCollection, hooks }
      const ctx = buildCtx(db, definition)

      await createDocument(ctx, { data: { title: 'Test', path: 'test' } })

      expect(callOrder).toEqual(['before', 'persist', 'after'])
    })

    it('afterCreate receives documentId and documentVersionId', async () => {
      const afterCreate = vi.fn()
      const { db } = createMockDb()
      const definition = { ...minimalCollection, hooks: { afterCreate } }
      const ctx = buildCtx(db, definition)

      await createDocument(ctx, { data: { title: 'X', path: 'x' } })

      expect(afterCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-1',
          documentVersionId: 'ver-1',
        })
      )
    })

    it('beforeCreate can mutate data before persistence', async () => {
      const { db, createDocumentVersion } = createMockDb()
      const definition = {
        ...minimalCollection,
        hooks: {
          beforeCreate: vi.fn(({ data }) => {
            data.title = 'Mutated'
          }),
        },
      }
      const ctx = buildCtx(db, definition)

      await createDocument(ctx, { data: { title: 'Original', path: 'p' } })

      const persistedData = createDocumentVersion.mock.calls[0]![0].documentData
      expect(persistedData.title).toBe('Mutated')
    })

    it('auto-generates path from title when missing', async () => {
      const { db, createDocumentVersion } = createMockDb()
      const ctx = buildCtx(db)

      await createDocument(ctx, { data: { title: 'My Great Post' } })

      const persistedData = createDocumentVersion.mock.calls[0]![0].documentData
      expect(persistedData.path).toBe('my-great-post')
    })

    it('works when no hooks are defined', async () => {
      const { db } = createMockDb()
      const ctx = buildCtx(db)

      // Should not throw
      const result = await createDocument(ctx, { data: { title: 'OK', path: 'ok' } })
      expect(result.documentId).toBe('doc-1')
    })

    it('supports an array of beforeCreate hooks executed in order', async () => {
      const callOrder: string[] = []

      const hooks = {
        beforeCreate: [
          vi.fn(async () => {
            callOrder.push('hook-1')
          }),
          vi.fn(async () => {
            callOrder.push('hook-2')
          }),
          vi.fn(async () => {
            callOrder.push('hook-3')
          }),
        ],
      }

      const { db, createDocumentVersion } = createMockDb()
      createDocumentVersion.mockImplementation(async () => {
        callOrder.push('persist')
        return { document: { id: 'ver-1', document_id: 'doc-1' }, fieldCount: 1 }
      })

      const definition = { ...minimalCollection, hooks }
      const ctx = buildCtx(db, definition)

      await createDocument(ctx, { data: { title: 'Test', path: 'test' } })

      expect(callOrder).toEqual(['hook-1', 'hook-2', 'hook-3', 'persist'])
      for (const fn of hooks.beforeCreate) {
        expect(fn).toHaveBeenCalledOnce()
      }
    })

    it('supports an array of afterCreate hooks executed in order', async () => {
      const callOrder: string[] = []

      const hooks = {
        afterCreate: [
          vi.fn(async () => {
            callOrder.push('after-1')
          }),
          vi.fn(async () => {
            callOrder.push('after-2')
          }),
        ],
      }

      const { db, createDocumentVersion } = createMockDb()
      createDocumentVersion.mockImplementation(async () => {
        callOrder.push('persist')
        return { document: { id: 'ver-1', document_id: 'doc-1' }, fieldCount: 1 }
      })

      const definition = { ...minimalCollection, hooks }
      const ctx = buildCtx(db, definition)

      await createDocument(ctx, { data: { title: 'Test', path: 'test' } })

      expect(callOrder).toEqual(['persist', 'after-1', 'after-2'])
    })

    it('array of beforeCreate hooks can each mutate data cumulatively', async () => {
      const { db, createDocumentVersion } = createMockDb()
      const definition = {
        ...minimalCollection,
        hooks: {
          beforeCreate: [
            vi.fn(({ data }) => {
              data.title = `${data.title}-A`
            }),
            vi.fn(({ data }) => {
              data.title = `${data.title}-B`
            }),
          ],
        },
      }
      const ctx = buildCtx(db, definition)

      await createDocument(ctx, { data: { title: 'Original', path: 'p' } })

      const persistedData = createDocumentVersion.mock.calls[0]![0].documentData
      expect(persistedData.title).toBe('Original-A-B')
    })
  })

  // -----------------------------------------------------------------------
  // updateDocument (PUT)
  // -----------------------------------------------------------------------
  describe('updateDocument', () => {
    it('fetches the original before calling hooks', async () => {
      const { db, getDocumentById, createDocumentVersion } = createMockDb()
      getDocumentById.mockResolvedValue({ title: 'Old', path: 'old', status: 'draft' })

      const beforeUpdate = vi.fn()
      const definition = { ...minimalCollection, hooks: { beforeUpdate } }
      const ctx = buildCtx(db, definition)

      await updateDocument(ctx, {
        documentId: 'doc-1',
        data: { title: 'New', path: 'new' },
      })

      // The hook should receive the REAL original, not the incoming data
      expect(beforeUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          originalData: expect.objectContaining({ title: 'Old' }),
          data: expect.objectContaining({ title: 'New' }),
        })
      )

      expect(createDocumentVersion).toHaveBeenCalledOnce()
    })

    it('afterUpdate receives documentId and documentVersionId', async () => {
      const afterUpdate = vi.fn()
      const { db, getDocumentById } = createMockDb()
      getDocumentById.mockResolvedValue({ title: 'Old', path: 'old' })

      const definition = { ...minimalCollection, hooks: { afterUpdate } }
      const ctx = buildCtx(db, definition)

      await updateDocument(ctx, {
        documentId: 'doc-1',
        data: { title: 'New', path: 'new' },
      })

      expect(afterUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-1',
          documentVersionId: 'ver-1',
        })
      )
    })

    it('sets status to the default status (draft)', async () => {
      const { db, getDocumentById, createDocumentVersion } = createMockDb()
      getDocumentById.mockResolvedValue({ title: 'Old', path: 'old', status: 'published' })
      const ctx = buildCtx(db)

      await updateDocument(ctx, {
        documentId: 'doc-1',
        data: { title: 'Updated', path: 'updated' },
      })

      expect(createDocumentVersion.mock.calls[0]![0].status).toBe('draft')
    })

    it('supports an array of beforeUpdate and afterUpdate hooks', async () => {
      const callOrder: string[] = []

      const hooks = {
        beforeUpdate: [
          vi.fn(async () => {
            callOrder.push('before-1')
          }),
          vi.fn(async () => {
            callOrder.push('before-2')
          }),
        ],
        afterUpdate: [
          vi.fn(async () => {
            callOrder.push('after-1')
          }),
          vi.fn(async () => {
            callOrder.push('after-2')
          }),
        ],
      }

      const { db, getDocumentById, createDocumentVersion } = createMockDb()
      getDocumentById.mockResolvedValue({ title: 'Old', path: 'old', status: 'draft' })
      createDocumentVersion.mockImplementation(async () => {
        callOrder.push('persist')
        return { document: { id: 'ver-1', document_id: 'doc-1' }, fieldCount: 1 }
      })

      const definition = { ...minimalCollection, hooks }
      const ctx = buildCtx(db, definition)

      await updateDocument(ctx, { documentId: 'doc-1', data: { title: 'New', path: 'new' } })

      expect(callOrder).toEqual(['before-1', 'before-2', 'persist', 'after-1', 'after-2'])
    })
  })

  // -----------------------------------------------------------------------
  // updateDocumentWithPatches
  // -----------------------------------------------------------------------
  describe('updateDocumentWithPatches', () => {
    it('throws DocumentNotFoundError when document is missing', async () => {
      const { db, getDocumentById } = createMockDb()
      getDocumentById.mockResolvedValue(null)
      const ctx = buildCtx(db)

      await expect(
        updateDocumentWithPatches(ctx, {
          documentId: 'doc-missing',
          patches: [],
        })
      ).rejects.toThrow(DocumentNotFoundError)
    })

    it('throws ConflictError on version mismatch', async () => {
      const { db, getDocumentById } = createMockDb()
      getDocumentById.mockResolvedValue({
        title: 'Old',
        path: 'old',
        document_version_id: 'ver-current',
      })
      const ctx = buildCtx(db)

      await expect(
        updateDocumentWithPatches(ctx, {
          documentId: 'doc-1',
          patches: [],
          documentVersionId: 'ver-stale',
        })
      ).rejects.toThrow(ConflictError)
    })

    it('throws PatchApplicationError when applyPatches returns errors', async () => {
      const { db, getDocumentById } = createMockDb()
      getDocumentById.mockResolvedValue({ title: 'Old', path: 'old' })
      const ctx = buildCtx(db)

      // array.move on a top-level (non-array) field should produce an error
      await expect(
        updateDocumentWithPatches(ctx, {
          documentId: 'doc-1',
          patches: [{ kind: 'array.move', path: 'title', itemId: 'x', toIndex: 0 }],
        })
      ).rejects.toThrow(PatchApplicationError)
    })

    it('persists patched data and invokes hooks', async () => {
      const { db, getDocumentById, createDocumentVersion } = createMockDb()
      getDocumentById.mockResolvedValue({ title: 'Old', path: 'old' })

      const afterUpdate = vi.fn()
      const definition = { ...minimalCollection, hooks: { afterUpdate } }
      const ctx = buildCtx(db, definition)

      await updateDocumentWithPatches(ctx, {
        documentId: 'doc-1',
        patches: [{ kind: 'field.set', path: 'title', value: 'Patched' }],
      })

      expect(createDocumentVersion).toHaveBeenCalledOnce()
      const persistedData = createDocumentVersion.mock.calls[0]![0].documentData
      expect(persistedData.title).toBe('Patched')

      expect(afterUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-1',
          documentVersionId: 'ver-1',
        })
      )
    })
  })

  // -----------------------------------------------------------------------
  // changeDocumentStatus
  // -----------------------------------------------------------------------
  describe('changeDocumentStatus', () => {
    it('validates and applies a valid transition', async () => {
      const { db, getDocumentById, setDocumentStatus } = createMockDb()
      getDocumentById.mockResolvedValue({
        status: 'draft',
        document_version_id: 'ver-1',
      })
      const ctx = buildCtx(db)

      const result = await changeDocumentStatus(ctx, {
        documentId: 'doc-1',
        nextStatus: 'published',
      })

      expect(setDocumentStatus).toHaveBeenCalledWith({
        document_version_id: 'ver-1',
        status: 'published',
      })
      expect(result.previousStatus).toBe('draft')
      expect(result.newStatus).toBe('published')
    })

    it('throws DocumentNotFoundError when document is missing', async () => {
      const { db, getDocumentById } = createMockDb()
      getDocumentById.mockResolvedValue(null)
      const ctx = buildCtx(db)

      await expect(
        changeDocumentStatus(ctx, { documentId: 'doc-1', nextStatus: 'published' })
      ).rejects.toThrow(DocumentNotFoundError)
    })

    it('throws InvalidTransitionError for an invalid transition', async () => {
      const { db, getDocumentById } = createMockDb()
      getDocumentById.mockResolvedValue({
        status: 'draft',
        document_version_id: 'ver-1',
      })
      const ctx = buildCtx(db)

      // draft → archived skips 'published', which is not ±1
      await expect(
        changeDocumentStatus(ctx, { documentId: 'doc-1', nextStatus: 'archived' })
      ).rejects.toThrow(InvalidTransitionError)
    })

    it('invokes beforeStatusChange and afterStatusChange hooks', async () => {
      const callOrder: string[] = []
      const hooks = {
        beforeStatusChange: vi.fn(async () => {
          callOrder.push('before')
        }),
        afterStatusChange: vi.fn(async () => {
          callOrder.push('after')
        }),
      }

      const { db, getDocumentById, setDocumentStatus } = createMockDb()
      getDocumentById.mockResolvedValue({ status: 'draft', document_version_id: 'ver-1' })
      setDocumentStatus.mockImplementation(async () => {
        callOrder.push('persist')
      })

      const definition = { ...minimalCollection, hooks }
      const ctx = buildCtx(db, definition)

      await changeDocumentStatus(ctx, { documentId: 'doc-1', nextStatus: 'published' })

      expect(callOrder).toEqual(['before', 'persist', 'after'])
      expect(hooks.beforeStatusChange).toHaveBeenCalledWith(
        expect.objectContaining({
          previousStatus: 'draft',
          nextStatus: 'published',
          documentId: 'doc-1',
          documentVersionId: 'ver-1',
        })
      )
    })

    it('does not invoke hooks when transition is invalid', async () => {
      const hooks = {
        beforeStatusChange: vi.fn(),
        afterStatusChange: vi.fn(),
      }

      const { db, getDocumentById } = createMockDb()
      getDocumentById.mockResolvedValue({ status: 'draft', document_version_id: 'ver-1' })

      const definition = { ...minimalCollection, hooks }
      const ctx = buildCtx(db, definition)

      await expect(
        changeDocumentStatus(ctx, { documentId: 'doc-1', nextStatus: 'archived' })
      ).rejects.toThrow(InvalidTransitionError)

      expect(hooks.beforeStatusChange).not.toHaveBeenCalled()
      expect(hooks.afterStatusChange).not.toHaveBeenCalled()
    })

    it('auto-archives other published versions when publishing', async () => {
      const { db, getDocumentById, archivePublishedVersions } = createMockDb()
      getDocumentById.mockResolvedValue({ status: 'draft', document_version_id: 'ver-1' })
      const ctx = buildCtx(db)

      await changeDocumentStatus(ctx, { documentId: 'doc-1', nextStatus: 'published' })

      expect(archivePublishedVersions).toHaveBeenCalledWith({
        document_id: 'doc-1',
        excludeVersionId: 'ver-1',
      })
    })

    it('supports an array of beforeStatusChange and afterStatusChange hooks', async () => {
      const callOrder: string[] = []

      const hooks = {
        beforeStatusChange: [
          vi.fn(async () => {
            callOrder.push('before-1')
          }),
          vi.fn(async () => {
            callOrder.push('before-2')
          }),
        ],
        afterStatusChange: [
          vi.fn(async () => {
            callOrder.push('after-1')
          }),
          vi.fn(async () => {
            callOrder.push('after-2')
          }),
        ],
      }

      const { db, getDocumentById, setDocumentStatus } = createMockDb()
      getDocumentById.mockResolvedValue({ status: 'draft', document_version_id: 'ver-1' })
      setDocumentStatus.mockImplementation(async () => {
        callOrder.push('persist')
      })

      const definition = { ...minimalCollection, hooks }
      const ctx = buildCtx(db, definition)

      await changeDocumentStatus(ctx, { documentId: 'doc-1', nextStatus: 'published' })

      expect(callOrder).toEqual(['before-1', 'before-2', 'persist', 'after-1', 'after-2'])
    })
  })

  // -----------------------------------------------------------------------
  // unpublishDocument
  // -----------------------------------------------------------------------
  describe('unpublishDocument', () => {
    it('calls archivePublishedVersions and returns count', async () => {
      const { db, archivePublishedVersions } = createMockDb()
      archivePublishedVersions.mockResolvedValue(1)
      const ctx = buildCtx(db)

      const result = await unpublishDocument(ctx, { documentId: 'doc-1' })
      expect(result.archivedCount).toBe(1)
      expect(archivePublishedVersions).toHaveBeenCalledWith({ document_id: 'doc-1' })
    })

    it('invokes beforeUnpublish and afterUnpublish hooks', async () => {
      const callOrder: string[] = []
      const hooks = {
        beforeUnpublish: vi.fn(async () => {
          callOrder.push('before')
        }),
        afterUnpublish: vi.fn(async () => {
          callOrder.push('after')
        }),
      }

      const { db, archivePublishedVersions } = createMockDb()
      archivePublishedVersions.mockImplementation(async () => {
        callOrder.push('archive')
        return 2
      })

      const definition = { ...minimalCollection, hooks }
      const ctx = buildCtx(db, definition)

      await unpublishDocument(ctx, { documentId: 'doc-1' })

      expect(callOrder).toEqual(['before', 'archive', 'after'])
      expect(hooks.afterUnpublish).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-1',
          archivedCount: 2,
        })
      )
    })

    it('works when no hooks are defined', async () => {
      const { db, archivePublishedVersions } = createMockDb()
      archivePublishedVersions.mockResolvedValue(0)
      const ctx = buildCtx(db)

      const result = await unpublishDocument(ctx, { documentId: 'doc-1' })
      expect(result.archivedCount).toBe(0)
    })

    it('supports an array of beforeUnpublish and afterUnpublish hooks', async () => {
      const callOrder: string[] = []

      const hooks = {
        beforeUnpublish: [
          vi.fn(async () => {
            callOrder.push('before-1')
          }),
          vi.fn(async () => {
            callOrder.push('before-2')
          }),
        ],
        afterUnpublish: [
          vi.fn(async () => {
            callOrder.push('after-1')
          }),
          vi.fn(async () => {
            callOrder.push('after-2')
          }),
        ],
      }

      const { db, archivePublishedVersions } = createMockDb()
      archivePublishedVersions.mockImplementation(async () => {
        callOrder.push('archive')
        return 2
      })

      const definition = { ...minimalCollection, hooks }
      const ctx = buildCtx(db, definition)

      await unpublishDocument(ctx, { documentId: 'doc-1' })

      expect(callOrder).toEqual(['before-1', 'before-2', 'archive', 'after-1', 'after-2'])
    })
  })
})
