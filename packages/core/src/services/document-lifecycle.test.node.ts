/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  AdminAuth,
  AuthError,
  AuthErrorCodes,
  createRequestContext,
  createSuperAdminContext,
} from '@byline/auth'
import { describe, expect, it, vi } from 'vitest'

import { BylineError, ERR_PATH_CONFLICT, ErrorCodes } from '../lib/errors.js'
import {
  changeDocumentStatus,
  copyToLocale,
  createDocument,
  deleteDocument,
  duplicateDocument,
  restoreDocumentVersion,
  unpublishDocument,
  updateDocument,
  updateDocumentSystemFields,
  updateDocumentWithPatches,
} from './document-lifecycle/index.js'
import type { CollectionDefinition, IDbAdapter } from '../@types/index.js'
import type { BylineLogger } from '../lib/logger.js'
import type { DocumentLifecycleContext } from './document-lifecycle/index.js'

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

const numericCollection: CollectionDefinition = {
  ...minimalCollection,
  fields: [
    { name: 'quantity', type: 'integer' },
    { name: 'score', type: 'float' },
    { name: 'price', type: 'decimal' },
  ],
}

/** Build a mock IDbAdapter. Returns the adapter plus individual mock fns. */
function createMockDb() {
  const createDocumentVersion = vi.fn().mockResolvedValue({
    document: { id: 'ver-1', document_id: 'doc-1' },
    fieldCount: 3,
  })
  const setDocumentStatus = vi.fn().mockResolvedValue(undefined)
  const archivePublishedVersions = vi.fn().mockResolvedValue(0)
  const softDeleteDocument = vi.fn().mockResolvedValue(1)
  const getDocumentById = vi.fn().mockResolvedValue(null)
  const getDocumentSystemFieldsForUpdate = vi.fn().mockResolvedValue(null)
  const getCurrentVersionMetadata = vi.fn().mockResolvedValue(null)
  const getCurrentPath = vi.fn().mockResolvedValue('current-path')
  // Audit capability (docs/06-auth-and-security/02-auditability.md — W2). `withTransaction` is a passthrough
  // in unit tests (runs the unit of work immediately, no real tx); `append`
  // records the calls so write-point tests can assert the audit rows emitted.
  const auditAppend = vi.fn().mockResolvedValue({ id: 'audit-1' })
  const withTransaction = vi.fn(async (fn: () => Promise<unknown>) => fn())

  const db: IDbAdapter = {
    commands: {
      collections: {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      documents: {
        createDocumentVersion,
        updateDocumentPath: vi.fn().mockResolvedValue(undefined) as any,
        setDocumentAvailableLocales: vi.fn().mockResolvedValue(undefined) as any,
        setDocumentStatus,
        archivePublishedVersions,
        softDeleteDocument,
        deleteDocumentLocale: vi.fn() as any,
        setOrderKey: vi.fn() as any,
        placeTreeNode: vi.fn() as any,
        removeFromTree: vi.fn() as any,
        promoteChildrenAndRemoveFromTree: vi.fn(async () => ({
          removed: {
            changed: false,
            before: { placed: false, parentDocumentId: null, orderKey: null, index: null },
            after: { placed: false, parentDocumentId: null, orderKey: null, index: null },
            beforeSiblingDocumentIds: [],
            beforeSubtreeDocumentIds: [],
          },
          promoted: [],
        })),
      },
      counters: {
        ensureCounterGroup: vi.fn() as any,
        nextCounterValue: vi.fn() as any,
        nextScopedCounterValue: vi.fn() as any,
      },
      audit: { append: auditAppend },
    },
    withTransaction: withTransaction as any,
    queries: {
      collections: {
        getAllCollections: vi.fn(),
        getCollectionByPath: vi.fn(),
        getCollectionById: vi.fn(),
      },
      documents: {
        getDocumentSystemFieldsForUpdate,
        getDocumentById,
        getCurrentVersionMetadata,
        getCurrentPath,
        getDocumentByPath: vi.fn(),
        getDocumentByVersion: vi.fn(),
        getDocumentsByVersionIds: vi.fn(),
        getDocumentsByDocumentIds: vi.fn(),
        getDocumentHistory: vi.fn(),
        getPublishedVersion: vi.fn(),
        getPublishedDocumentIds: vi.fn(),
        getDocumentCountsByStatus: vi.fn(),
        findDocuments: vi.fn(),
        getLastOrderKey: vi.fn() as any,
        getNeighborOrderKeys: vi.fn() as any,
        getCanonicalDocumentOrder: vi.fn() as any,
        getTreeAncestors: vi.fn() as any,
        getTreeChildren: vi.fn() as any,
        getTreeParent: vi.fn() as any,
        getTreeSubtree: vi.fn() as any,
      },
      audit: {
        getDocumentAuditLog: vi.fn(async () => ({
          entries: [],
          meta: { total: 0, page: 1, pageSize: 20, totalPages: 0 },
        })),
        findAuditLog: vi.fn(async () => ({
          entries: [],
          meta: { total: 0, page: 1, pageSize: 20, totalPages: 0 },
        })),
      },
    },
  }

  return {
    db,
    createDocumentVersion,
    setDocumentStatus,
    archivePublishedVersions,
    softDeleteDocument,
    getDocumentById,
    getDocumentSystemFieldsForUpdate,
    getCurrentVersionMetadata,
    getCurrentPath,
    auditAppend,
    withTransaction,
  }
}

const noopLogger: BylineLogger = {
  log: vi.fn(),
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
}

// A real persisted-user id is a UUID; `actorId()` only attributes UUIDs (see
// the regression note below). Use a valid UUID so the default context's
// writes are attributed.
const TEST_ACTOR_ID = '01901234-0000-7000-8000-000000000001'

function buildCtx(
  db: IDbAdapter,
  definition: CollectionDefinition = minimalCollection
): DocumentLifecycleContext {
  return {
    db,
    definition,
    collectionId: 'col-1',
    collectionVersion: 1,
    collectionPath: definition.path,
    logger: noopLogger,
    defaultLocale: 'en',
    // Inject a super-admin context by default so the bulk of existing
    // tests do not have to care about ability enforcement. The dedicated
    // "enforcement" block below covers the missing-context / missing-ability
    // negative cases.
    requestContext: createSuperAdminContext({ id: TEST_ACTOR_ID }),
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
        data: { title: 'Hello' },
        locale: 'en',
      })

      expect(createDocumentVersion).toHaveBeenCalledOnce()
      expect(result.documentId).toBe('doc-1')
      expect(result.documentVersionId).toBe('ver-1')
    })

    it('passes the acting user id as createdBy for the audit trail', async () => {
      const { db, createDocumentVersion } = createMockDb()
      const ctx = buildCtx(db)

      await createDocument(ctx, {
        data: { title: 'Hello' },
        locale: 'en',
      })

      // Audit contract (docs/06-auth-and-security/02-auditability.md — W1): every version row
      // records the actor that created it.
      expect(createDocumentVersion.mock.calls[0]?.[0].createdBy).toBe(TEST_ACTOR_ID)
    })

    it('writes NULL createdBy for a synthetic (non-UUID) script/seed actor', async () => {
      // Regression guard (v3.8.0): a synthetic super-admin id such as
      // `import-docs-script` is not a real user and is not a UUID — writing
      // it into the `created_by` UUID column crashed every import/seed. Such
      // system/tooling writes must attribute to NULL, not the synthetic id.
      const { db, createDocumentVersion } = createMockDb()
      const ctx = buildCtx(db)
      ctx.requestContext = createSuperAdminContext({ id: 'import-docs-script' })

      await createDocument(ctx, { data: { title: 'Hello' }, locale: 'en' })

      expect(createDocumentVersion.mock.calls[0]?.[0].createdBy).toBeUndefined()
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

      await createDocument(ctx, { data: { title: 'Test' } })

      expect(callOrder).toEqual(['before', 'persist', 'after'])
    })

    it('afterCreate receives documentId and documentVersionId', async () => {
      const afterCreate = vi.fn()
      const { db } = createMockDb()
      const definition = { ...minimalCollection, hooks: { afterCreate } }
      const ctx = buildCtx(db, definition)

      await createDocument(ctx, { data: { title: 'X' } })

      expect(afterCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-1',
          documentVersionId: 'ver-1',
        })
      )
    })

    it('afterCreate receives the resolved canonical path', async () => {
      const afterCreate = vi.fn()
      const { db } = createMockDb()
      const definition = { ...minimalCollection, hooks: { afterCreate } }
      const ctx = buildCtx(db, definition)

      await createDocument(ctx, { data: { title: 'X' }, path: 'my-explicit-path' })

      expect(afterCreate).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'my-explicit-path' })
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

      await createDocument(ctx, { data: { title: 'Original' } })

      const persistedData = createDocumentVersion.mock.calls[0]?.[0].documentData
      expect(persistedData.title).toBe('Mutated')
    })

    it('normalizes numeric values before and after beforeCreate', async () => {
      const { db, createDocumentVersion } = createMockDb()
      const beforeCreate = vi.fn(({ data }) => {
        expect(data).toMatchObject({ quantity: 2, score: 1.5, price: '10.00' })
        data.quantity = '3'
        data.price = 12.5
      })
      const definition = { ...numericCollection, hooks: { beforeCreate } }

      await createDocument(buildCtx(db, definition), {
        data: { quantity: '2', score: '1.5', price: ' 10.00 ' },
      })

      expect(createDocumentVersion.mock.calls[0]?.[0].documentData).toMatchObject({
        quantity: 3,
        score: 1.5,
        price: '12.5',
      })
    })

    it('derives path from useAsPath source field via the slugifier', async () => {
      const { db, createDocumentVersion } = createMockDb()
      const definition: CollectionDefinition = { ...minimalCollection, useAsPath: 'title' }
      const ctx = buildCtx(db, definition)

      await createDocument(ctx, { data: { title: 'My Great Post' } })

      const persistedPath = createDocumentVersion.mock.calls[0]?.[0].path
      expect(persistedPath).toBe('my-great-post')
    })

    it('uses an explicit params.path verbatim, bypassing derivation', async () => {
      const { db, createDocumentVersion } = createMockDb()
      const definition: CollectionDefinition = { ...minimalCollection, useAsPath: 'title' }
      const ctx = buildCtx(db, definition)

      await createDocument(ctx, {
        data: { title: 'Will Be Ignored' },
        path: 'custom/route',
      })

      const persistedPath = createDocumentVersion.mock.calls[0]?.[0].path
      expect(persistedPath).toBe('custom/route')
    })

    it('falls back to a UUID when no useAsPath and no explicit path', async () => {
      const { db, createDocumentVersion } = createMockDb()
      const ctx = buildCtx(db) // minimalCollection has no useAsPath

      await createDocument(ctx, { data: { title: 'Anything' } })

      const persistedPath = createDocumentVersion.mock.calls[0]?.[0].path
      expect(persistedPath).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      )
    })

    it('rejects creates in any non-default locale', async () => {
      const { db, createDocumentVersion } = createMockDb()
      const ctx = buildCtx(db)

      await expect(
        createDocument(ctx, { data: { title: 'Hello' }, locale: 'fr' })
      ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION })

      expect(createDocumentVersion).not.toHaveBeenCalled()
    })

    it('works when no hooks are defined', async () => {
      const { db } = createMockDb()
      const ctx = buildCtx(db)

      // Should not throw
      const result = await createDocument(ctx, { data: { title: 'OK' } })
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

      await createDocument(ctx, { data: { title: 'Test' } })

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

      await createDocument(ctx, { data: { title: 'Test' } })

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

      await createDocument(ctx, { data: { title: 'Original' } })

      const persistedData = createDocumentVersion.mock.calls[0]?.[0].documentData
      expect(persistedData.title).toBe('Original-A-B')
    })
  })

  // -----------------------------------------------------------------------
  // updateDocument (PUT)
  // -----------------------------------------------------------------------
  describe('updateDocument', () => {
    it('passes the acting user id as createdBy for the audit trail', async () => {
      const { db, getDocumentById, createDocumentVersion } = createMockDb()
      getDocumentById.mockResolvedValue({ status: 'draft', fields: { title: 'Old' } })
      const ctx = buildCtx(db)

      await updateDocument(ctx, {
        documentId: 'doc-1',
        data: { title: 'New' },
      })

      expect(createDocumentVersion.mock.calls[0]?.[0].createdBy).toBe(TEST_ACTOR_ID)
    })

    it('fetches the original before calling hooks', async () => {
      const { db, getDocumentById, createDocumentVersion } = createMockDb()
      getDocumentById.mockResolvedValue({ status: 'draft', fields: { title: 'Old' } })

      const beforeUpdate = vi.fn()
      const definition = { ...minimalCollection, hooks: { beforeUpdate } }
      const ctx = buildCtx(db, definition)

      await updateDocument(ctx, {
        documentId: 'doc-1',
        data: { title: 'New' },
      })

      // The hook should receive the REAL original, not the incoming data
      expect(beforeUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          originalData: expect.objectContaining({
            fields: expect.objectContaining({ title: 'Old' }),
          }),
          data: expect.objectContaining({ title: 'New' }),
        })
      )

      expect(createDocumentVersion).toHaveBeenCalledOnce()
    })

    it('normalizes numeric values before and after beforeUpdate', async () => {
      const { db, getDocumentById, createDocumentVersion } = createMockDb()
      getDocumentById.mockResolvedValue({ fields: { quantity: 1, score: 1, price: '1.0' } })
      const beforeUpdate = vi.fn(({ data }) => {
        expect(data.score).toBe(25)
        data.score = '3.5'
      })
      const definition = { ...numericCollection, hooks: { beforeUpdate } }

      await updateDocument(buildCtx(db, definition), {
        documentId: 'doc-1',
        data: { quantity: '2', score: '2.5e1', price: 4.25 },
      })

      expect(createDocumentVersion.mock.calls[0]?.[0].documentData).toEqual({
        quantity: 2,
        score: 3.5,
        price: '4.25',
      })
    })

    it('afterUpdate receives documentId and documentVersionId', async () => {
      const afterUpdate = vi.fn()
      const { db, getDocumentById } = createMockDb()
      getDocumentById.mockResolvedValue({ fields: { title: 'Old' } })

      const definition = { ...minimalCollection, hooks: { afterUpdate } }
      const ctx = buildCtx(db, definition)

      await updateDocument(ctx, {
        documentId: 'doc-1',
        data: { title: 'New' },
      })

      expect(afterUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-1',
          documentVersionId: 'ver-1',
        })
      )
    })

    it('afterUpdate carries the sticky path forward when none is supplied', async () => {
      const afterUpdate = vi.fn()
      const { db, getDocumentById } = createMockDb()
      getDocumentById.mockResolvedValue({
        document_version_id: 'prev-ver',
        path: 'sticky-path',
        fields: { title: 'Old' },
      })

      const definition = { ...minimalCollection, hooks: { afterUpdate } }
      const ctx = buildCtx(db, definition)

      await updateDocument(ctx, { documentId: 'doc-1', data: { title: 'New' } })

      expect(afterUpdate).toHaveBeenCalledWith(expect.objectContaining({ path: 'sticky-path' }))
    })

    it('afterUpdate surfaces an explicitly-supplied path', async () => {
      const afterUpdate = vi.fn()
      const { db, getDocumentById } = createMockDb()
      getDocumentById.mockResolvedValue({
        document_version_id: 'prev-ver',
        path: 'sticky-path',
        fields: { title: 'Old' },
      })

      const definition = { ...minimalCollection, hooks: { afterUpdate } }
      const ctx = buildCtx(db, definition)

      await updateDocument(ctx, {
        documentId: 'doc-1',
        data: { title: 'New' },
        path: 'new-path',
      })

      expect(afterUpdate).toHaveBeenCalledWith(expect.objectContaining({ path: 'new-path' }))
    })

    it('does not pass path to the storage primitive when no explicit path is supplied', async () => {
      const { db, getDocumentById, createDocumentVersion } = createMockDb()
      getDocumentById.mockResolvedValue({
        document_version_id: 'prev-ver',
        path: 'original-path',
        status: 'draft',
        fields: { title: 'Old' },
      })
      const definition: CollectionDefinition = { ...minimalCollection, useAsPath: 'title' }
      const ctx = buildCtx(db, definition)

      await updateDocument(ctx, {
        documentId: 'doc-1',
        data: { title: 'Brand New Title' },
      })

      // Sticky path semantics: the storage layer is not asked to write the
      // path row; the existing byline_document_paths row stays as-is.
      expect(createDocumentVersion.mock.calls[0]?.[0].path).toBeUndefined()
    })

    it('uses an explicit params.path verbatim on update, overriding the sticky value', async () => {
      const { db, getDocumentById, createDocumentVersion } = createMockDb()
      getDocumentById.mockResolvedValue({
        document_version_id: 'prev-ver',
        path: 'original-path',
        status: 'draft',
        fields: { title: 'Old' },
      })
      const ctx = buildCtx(db)

      await updateDocument(ctx, {
        documentId: 'doc-1',
        data: { title: 'New' },
        path: 'manually-set',
      })

      expect(createDocumentVersion.mock.calls[0]?.[0].path).toBe('manually-set')
    })

    it('sets status to the default status (draft)', async () => {
      const { db, getDocumentById, createDocumentVersion } = createMockDb()
      getDocumentById.mockResolvedValue({
        status: 'published',
        fields: { title: 'Old' },
      })
      const ctx = buildCtx(db)

      await updateDocument(ctx, {
        documentId: 'doc-1',
        data: { title: 'Updated' },
      })

      expect(createDocumentVersion.mock.calls[0]?.[0].status).toBe('draft')
    })

    it('drops path changes silently with a logger.warn on non-source-locale (translation) saves', async () => {
      const { db, getDocumentById, createDocumentVersion } = createMockDb()
      getDocumentById.mockResolvedValue({
        document_version_id: 'prev-ver',
        path: 'about',
        source_locale: 'en',
        status: 'draft',
        fields: { title: 'About' },
      })
      const ctx = buildCtx(db)
      const warn = ctx.logger?.warn as ReturnType<typeof vi.fn>
      warn.mockClear()

      await updateDocument(ctx, {
        documentId: 'doc-1',
        data: { title: 'À propos' },
        locale: 'fr',
        path: 'a-propos',
      })

      // Save still proceeds — the version row is created — but the path
      // row is left untouched (no `path` flows to the storage primitive).
      expect(createDocumentVersion).toHaveBeenCalledOnce()
      expect(createDocumentVersion.mock.calls[0]?.[0].path).toBeUndefined()
      expect(createDocumentVersion.mock.calls[0]?.[0].locale).toBe('fr')

      // The caller is informed via a structured warn.
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-1',
          requestedLocale: 'fr',
          sourceLocale: 'en',
          suppliedPath: 'a-propos',
          currentPath: 'about',
        }),
        expect.stringContaining('path changes apply only on source-locale writes')
      )
    })

    it('writes the path on a source-locale save even when it differs from the global default', async () => {
      // Document anchored to de (re-anchored, or authored before a global
      // default switch); the global default is en. A de save is the
      // source-locale write, so the supplied path must flow through.
      const { db, getDocumentById, createDocumentVersion } = createMockDb()
      getDocumentById.mockResolvedValue({
        document_version_id: 'prev-ver',
        path: 'ueber-uns',
        source_locale: 'de',
        status: 'draft',
        fields: { title: 'Über uns' },
      })
      const ctx = buildCtx(db)

      await updateDocument(ctx, {
        documentId: 'doc-1',
        data: { title: 'Über uns — neu' },
        locale: 'de',
        path: 'ueber-uns-neu',
      })

      expect(createDocumentVersion.mock.calls[0]?.[0].path).toBe('ueber-uns-neu')
    })

    it('does not warn when a translation save supplies the same path as current', async () => {
      const { db, getDocumentById } = createMockDb()
      getDocumentById.mockResolvedValue({
        document_version_id: 'prev-ver',
        path: 'about',
        status: 'draft',
        fields: { title: 'About' },
      })
      const ctx = buildCtx(db)
      const warn = ctx.logger?.warn as ReturnType<typeof vi.fn>
      warn.mockClear()

      await updateDocument(ctx, {
        documentId: 'doc-1',
        data: { title: 'À propos' },
        locale: 'fr',
        path: 'about', // same as currentPath — idempotent, no warn
      })

      expect(warn).not.toHaveBeenCalled()
    })

    it('translates a Postgres unique-constraint violation on the path index to ERR_PATH_CONFLICT', async () => {
      const { db, getDocumentById, createDocumentVersion } = createMockDb()
      getDocumentById.mockResolvedValue({
        document_version_id: 'prev-ver',
        path: 'about',
        status: 'draft',
        fields: { title: 'About' },
      })
      // Simulate the pg driver throwing a unique-violation on the path
      // constraint when the upsert tries to claim a slug owned by another
      // document in the same (collection, locale).
      createDocumentVersion.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
          constraint: 'idx_document_paths_collection_locale_path',
        })
      )
      const ctx = buildCtx(db)

      try {
        await updateDocument(ctx, {
          documentId: 'doc-1',
          data: { title: 'About' },
          path: 'home', // collides
        })
        throw new Error('expected ERR_PATH_CONFLICT')
      } catch (err) {
        expect(err).toBeInstanceOf(BylineError)
        expect((err as BylineError).code).toBe(ErrorCodes.PATH_CONFLICT)
      }
    })

    it('rethrows non-23505 errors unchanged', async () => {
      const { db, getDocumentById, createDocumentVersion } = createMockDb()
      getDocumentById.mockResolvedValue({
        document_version_id: 'prev-ver',
        path: 'about',
        status: 'draft',
        fields: { title: 'About' },
      })
      const original = new Error('connection refused')
      createDocumentVersion.mockRejectedValueOnce(original)
      const ctx = buildCtx(db)

      await expect(
        updateDocument(ctx, { documentId: 'doc-1', data: { title: 'X' }, path: 'home' })
      ).rejects.toBe(original)
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
      getDocumentById.mockResolvedValue({ status: 'draft', fields: { title: 'Old' } })
      createDocumentVersion.mockImplementation(async () => {
        callOrder.push('persist')
        return { document: { id: 'ver-1', document_id: 'doc-1' }, fieldCount: 1 }
      })

      const definition = { ...minimalCollection, hooks }
      const ctx = buildCtx(db, definition)

      await updateDocument(ctx, { documentId: 'doc-1', data: { title: 'New' } })

      expect(callOrder).toEqual(['before-1', 'before-2', 'persist', 'after-1', 'after-2'])
    })
  })

  // -----------------------------------------------------------------------
  // updateDocumentWithPatches
  // -----------------------------------------------------------------------
  describe('updateDocumentWithPatches', () => {
    it('throws ERR_NOT_FOUND when document is missing', async () => {
      const { db, getDocumentById } = createMockDb()
      getDocumentById.mockResolvedValue(null)
      const ctx = buildCtx(db)

      await expect(
        updateDocumentWithPatches(ctx, {
          documentId: 'doc-missing',
          patches: [],
        })
      ).rejects.toSatisfy(
        (err: BylineError) => err instanceof BylineError && err.code === ErrorCodes.NOT_FOUND
      )
    })

    it('throws ERR_CONFLICT on version mismatch', async () => {
      const { db, getDocumentById } = createMockDb()
      getDocumentById.mockResolvedValue({
        document_version_id: 'ver-current',
        fields: { title: 'Old' },
      })
      const ctx = buildCtx(db)

      await expect(
        updateDocumentWithPatches(ctx, {
          documentId: 'doc-1',
          patches: [],
          documentVersionId: 'ver-stale',
        })
      ).rejects.toSatisfy(
        (err: BylineError) => err instanceof BylineError && err.code === ErrorCodes.CONFLICT
      )
    })

    it('throws ERR_PATCH_FAILED when applyPatches returns errors', async () => {
      const { db, getDocumentById } = createMockDb()
      getDocumentById.mockResolvedValue({ fields: { title: 'Old' } })
      const ctx = buildCtx(db)

      // array.move on a top-level (non-array) field should produce an error
      await expect(
        updateDocumentWithPatches(ctx, {
          documentId: 'doc-1',
          patches: [{ kind: 'array.move', path: 'title', itemId: 'x', toIndex: 0 }],
        })
      ).rejects.toSatisfy(
        (err: BylineError) => err instanceof BylineError && err.code === ErrorCodes.PATCH_FAILED
      )
    })

    it('persists patched data and invokes hooks', async () => {
      const { db, getDocumentById, createDocumentVersion } = createMockDb()
      getDocumentById.mockResolvedValue({ fields: { title: 'Old' } })

      const afterUpdate = vi.fn()
      const definition = { ...minimalCollection, hooks: { afterUpdate } }
      const ctx = buildCtx(db, definition)

      await updateDocumentWithPatches(ctx, {
        documentId: 'doc-1',
        patches: [{ kind: 'field.set', path: 'title', value: 'Patched' }],
      })

      expect(createDocumentVersion).toHaveBeenCalledOnce()
      const persistedData = createDocumentVersion.mock.calls[0]?.[0].documentData
      expect(persistedData.title).toBe('Patched')

      expect(afterUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-1',
          documentVersionId: 'ver-1',
        })
      )
    })

    it('normalizes patched and hook-produced numeric values before persistence', async () => {
      const { db, getDocumentById, createDocumentVersion } = createMockDb()
      getDocumentById.mockResolvedValue({
        fields: { quantity: 1, score: 1, price: '1.00' },
      })
      const beforeUpdate = vi.fn(({ data }) => {
        expect(data.quantity).toBe(7)
        data.price = ' 8.500 '
      })
      const definition = { ...numericCollection, hooks: { beforeUpdate } }

      await updateDocumentWithPatches(buildCtx(db, definition), {
        documentId: 'doc-1',
        patches: [
          { kind: 'field.set', path: 'quantity', value: '7.0' },
          { kind: 'field.set', path: 'score', value: '2.75' },
        ],
      })

      expect(createDocumentVersion.mock.calls[0]?.[0].documentData).toEqual({
        quantity: 7,
        score: 2.75,
        price: '8.500',
      })
    })
  })

  // -----------------------------------------------------------------------
  // changeDocumentStatus
  // -----------------------------------------------------------------------
  describe('changeDocumentStatus', () => {
    const metadataRow = {
      document_version_id: 'ver-1',
      document_id: 'doc-1',
      collection_id: 'col-1',
      path: 'hello',
      status: 'draft',
      created_at: new Date(),
      updated_at: new Date(),
    }

    it('validates and applies a valid transition', async () => {
      const { db, getCurrentVersionMetadata, setDocumentStatus } = createMockDb()
      getCurrentVersionMetadata.mockResolvedValue({ ...metadataRow })
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

    it('records a document.status.changed audit row atomically (from → to)', async () => {
      const { db, getCurrentVersionMetadata, auditAppend, withTransaction } = createMockDb()
      getCurrentVersionMetadata.mockResolvedValue({ ...metadataRow })
      const ctx = buildCtx(db)

      await changeDocumentStatus(ctx, { documentId: 'doc-1', nextStatus: 'published' })

      // The mutation + audit row run inside one withTransaction (docs/06-auth-and-security/02-auditability.md).
      expect(withTransaction).toHaveBeenCalledOnce()
      expect(auditAppend).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-1',
          collectionId: 'col-1',
          actorId: TEST_ACTOR_ID,
          actorRealm: 'admin',
          action: 'document.status.changed',
          field: 'status',
          before: 'draft',
          after: 'published',
        })
      )
    })

    it('throws ERR_NOT_FOUND when document is missing', async () => {
      const { db, getCurrentVersionMetadata } = createMockDb()
      getCurrentVersionMetadata.mockResolvedValue(null)
      const ctx = buildCtx(db)

      await expect(
        changeDocumentStatus(ctx, { documentId: 'doc-1', nextStatus: 'published' })
      ).rejects.toSatisfy(
        (err: BylineError) => err instanceof BylineError && err.code === ErrorCodes.NOT_FOUND
      )
    })

    it('throws ERR_INVALID_TRANSITION for an invalid transition', async () => {
      const { db, getCurrentVersionMetadata } = createMockDb()
      getCurrentVersionMetadata.mockResolvedValue({ ...metadataRow })
      const ctx = buildCtx(db)

      // draft → archived skips 'published', which is not ±1
      await expect(
        changeDocumentStatus(ctx, { documentId: 'doc-1', nextStatus: 'archived' })
      ).rejects.toSatisfy(
        (err: BylineError) =>
          err instanceof BylineError && err.code === ErrorCodes.INVALID_TRANSITION
      )
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

      const { db, getCurrentVersionMetadata, setDocumentStatus } = createMockDb()
      getCurrentVersionMetadata.mockResolvedValue({ ...metadataRow })
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
          path: 'current-path',
        })
      )
      expect(hooks.afterStatusChange).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'current-path' })
      )
    })

    it('does not invoke hooks when transition is invalid', async () => {
      const hooks = {
        beforeStatusChange: vi.fn(),
        afterStatusChange: vi.fn(),
      }

      const { db, getCurrentVersionMetadata } = createMockDb()
      getCurrentVersionMetadata.mockResolvedValue({ ...metadataRow })

      const definition = { ...minimalCollection, hooks }
      const ctx = buildCtx(db, definition)

      await expect(
        changeDocumentStatus(ctx, { documentId: 'doc-1', nextStatus: 'archived' })
      ).rejects.toSatisfy(
        (err: BylineError) =>
          err instanceof BylineError && err.code === ErrorCodes.INVALID_TRANSITION
      )

      expect(hooks.beforeStatusChange).not.toHaveBeenCalled()
      expect(hooks.afterStatusChange).not.toHaveBeenCalled()
    })

    it('auto-archives other published versions when publishing', async () => {
      const { db, getCurrentVersionMetadata, archivePublishedVersions } = createMockDb()
      getCurrentVersionMetadata.mockResolvedValue({ ...metadataRow })
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

      const { db, getCurrentVersionMetadata, setDocumentStatus } = createMockDb()
      getCurrentVersionMetadata.mockResolvedValue({ ...metadataRow })
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

    it('records an atomic published to archived status audit when versions change', async () => {
      const { db, archivePublishedVersions, auditAppend, withTransaction } = createMockDb()
      archivePublishedVersions.mockResolvedValue(2)

      await unpublishDocument(buildCtx(db), { documentId: 'doc-1' })

      expect(withTransaction).toHaveBeenCalledOnce()
      expect(auditAppend).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-1',
          collectionId: 'col-1',
          actorId: TEST_ACTOR_ID,
          actorRealm: 'admin',
          action: 'document.status.changed',
          field: 'status',
          before: 'published',
          after: 'archived',
        })
      )
    })

    it('does not record an audit row when no published version changes', async () => {
      const { db, archivePublishedVersions, auditAppend } = createMockDb()
      archivePublishedVersions.mockResolvedValue(0)

      await unpublishDocument(buildCtx(db), { documentId: 'doc-1' })

      expect(auditAppend).not.toHaveBeenCalled()
    })

    it('does not run afterUnpublish when the atomic audit unit fails', async () => {
      const afterUnpublish = vi.fn()
      const { db, archivePublishedVersions, auditAppend } = createMockDb()
      archivePublishedVersions.mockResolvedValue(1)
      auditAppend.mockRejectedValue(new Error('audit failed'))

      await expect(
        unpublishDocument(buildCtx(db, { ...minimalCollection, hooks: { afterUnpublish } }), {
          documentId: 'doc-1',
        })
      ).rejects.toThrow('audit failed')
      expect(afterUnpublish).not.toHaveBeenCalled()
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
      expect(hooks.beforeUnpublish).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: 'doc-1', path: 'current-path' })
      )
      expect(hooks.afterUnpublish).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-1',
          archivedCount: 2,
          path: 'current-path',
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

  // -----------------------------------------------------------------------
  // deleteDocument
  // -----------------------------------------------------------------------
  describe('deleteDocument', () => {
    it('invokes beforeDelete / afterDelete with the document path', async () => {
      const beforeDelete = vi.fn()
      const afterDelete = vi.fn()
      const { db, getDocumentById } = createMockDb()
      getDocumentById.mockResolvedValue({
        document_version_id: 'ver-1',
        document_id: 'doc-1',
        path: 'doc-to-delete',
        fields: {},
      })

      const definition = { ...minimalCollection, hooks: { beforeDelete, afterDelete } }
      const ctx = buildCtx(db, definition)

      await deleteDocument(ctx, { documentId: 'doc-1' })

      expect(beforeDelete).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: 'doc-1', path: 'doc-to-delete' })
      )
      expect(afterDelete).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: 'doc-1', path: 'doc-to-delete' })
      )
    })

    it('records a document.deleted audit row atomically with the soft-delete', async () => {
      const { db, getDocumentById, softDeleteDocument, auditAppend, withTransaction } =
        createMockDb()
      getDocumentById.mockResolvedValue({
        document_version_id: 'ver-1',
        document_id: 'doc-1',
        path: 'doc-to-delete',
        fields: {},
      })
      const ctx = buildCtx(db)

      await deleteDocument(ctx, { documentId: 'doc-1' })

      expect(withTransaction).toHaveBeenCalledOnce()
      expect(softDeleteDocument).toHaveBeenCalledWith({ document_id: 'doc-1' })
      expect(auditAppend).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-1',
          collectionId: 'col-1',
          actorRealm: 'admin',
          action: 'document.deleted',
        })
      )
    })

    it('rejects a beforeDelete failure without soft-deleting the document', async () => {
      const beforeDelete = vi.fn(async () => {
        throw new Error('pre-commit hook failed')
      })
      const afterDelete = vi.fn()
      const { db, getDocumentById, softDeleteDocument } = createMockDb()
      getDocumentById.mockResolvedValue({
        document_version_id: 'ver-1',
        document_id: 'doc-1',
        path: 'doc-to-delete',
        fields: {},
      })
      const definition = { ...minimalCollection, hooks: { beforeDelete, afterDelete } }

      await expect(
        deleteDocument(buildCtx(db, definition), { documentId: 'doc-1' })
      ).rejects.toThrow('pre-commit hook failed')

      expect(softDeleteDocument).not.toHaveBeenCalled()
      expect(afterDelete).not.toHaveBeenCalled()
    })

    it('cleans up stored files for upload fields at any nesting depth', async () => {
      const { db, getDocumentById } = createMockDb()
      const upload = { mimeTypes: ['application/pdf'], maxFileSize: 1024 }
      const definition: CollectionDefinition = {
        ...minimalCollection,
        fields: [
          { name: 'cover', label: 'Cover', type: 'image', upload },
          {
            name: 'files',
            label: 'Files',
            type: 'array',
            fields: [
              {
                name: 'filesGroup',
                type: 'group',
                fields: [{ name: 'publicationFile', label: 'File', type: 'file', upload }],
              },
            ],
          },
        ],
      }
      getDocumentById.mockResolvedValue({
        document_version_id: 'ver-1',
        document_id: 'doc-1',
        path: 'doc-to-delete',
        fields: {
          cover: {
            storagePath: 'covers/original.jpg',
            variants: [{ storagePath: 'covers/thumb.avif' }],
          },
          files: [
            { filesGroup: { publicationFile: { storagePath: 'files/a.pdf' } } },
            { filesGroup: { publicationFile: null } },
            { filesGroup: { publicationFile: { storagePath: 'files/b.pdf' } } },
          ],
        },
      })
      const storageDelete = vi.fn().mockResolvedValue(undefined)
      const ctx = {
        ...buildCtx(db, definition),
        storage: { delete: storageDelete } as any,
      }

      await deleteDocument(ctx, { documentId: 'doc-1' })

      // reconstruct: true because the collection is upload-capable
      expect(getDocumentById).toHaveBeenCalledWith(expect.objectContaining({ reconstruct: true }))
      expect(storageDelete.mock.calls.map((c) => c[0])).toEqual([
        'covers/original.jpg',
        'covers/thumb.avif',
        'files/a.pdf',
        'files/b.pdf',
      ])
    })

    it('returns only allowlisted failures and keeps raw details in internal logs', async () => {
      const { db, getDocumentById } = createMockDb()
      const upload = { mimeTypes: ['application/pdf'], maxFileSize: 1024 }
      const hookError = Object.assign(new Error('hook leaked private/hooks/search.ts'), {
        code: 'ERR_SEARCH',
      })
      const definition: CollectionDefinition = {
        ...minimalCollection,
        fields: [{ name: 'file', label: 'File', type: 'file', upload }],
        hooks: {
          afterDelete: async () => {
            throw hookError
          },
        },
      }
      getDocumentById.mockResolvedValue({
        document_version_id: 'ver-1',
        document_id: 'doc-1',
        path: 'doc-to-delete',
        fields: {
          file: {
            storagePath: 'private/original.pdf',
            variants: [
              { storagePath: 'private/preview.pdf' },
              { storagePath: 'private/thumbnail.pdf' },
            ],
          },
        },
      })
      const storageDelete = vi.fn(async (storagePath: string) => {
        if (storagePath === 'private/original.pdf') {
          throw Object.assign(new Error('storage unavailable'), { code: ErrorCodes.STORAGE })
        }
        if (storagePath === 'private/thumbnail.pdf') throw new Error('cleanup failed')
      })
      const ctx = {
        ...buildCtx(db, definition),
        storage: { delete: storageDelete } as any,
        logger: { ...noopLogger, error: vi.fn() },
      }

      const result = await deleteDocument(ctx, { documentId: 'doc-1' })

      expect(storageDelete.mock.calls.map((call) => call[0])).toEqual([
        'private/original.pdf',
        'private/preview.pdf',
        'private/thumbnail.pdf',
      ])
      expect(result).toEqual({
        deletedVersionCount: 1,
        outcome: 'committed-with-side-effect-failures',
        sideEffectFailures: [
          { phase: 'storageCleanup', code: 'ERR_STORAGE' },
          { phase: 'storageCleanup', code: 'ERR_UNHANDLED' },
          { phase: 'afterDelete', code: 'ERR_UNHANDLED' },
        ],
      })
      const serializedResult = JSON.stringify(result)
      expect(serializedResult).not.toContain('storage unavailable')
      expect(serializedResult).not.toContain('cleanup failed')
      expect(serializedResult).not.toContain('hook leaked')
      expect(serializedResult).not.toContain('private/')
      expect(serializedResult).not.toContain('ERR_SEARCH')
      expect(ctx.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.objectContaining({ message: 'storage unavailable' }),
          documentId: 'doc-1',
          storagePath: 'private/original.pdf',
        }),
        'failed to delete storage file'
      )
      expect(ctx.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.objectContaining({ message: 'cleanup failed' }),
          documentId: 'doc-1',
          storagePath: 'private/thumbnail.pdf',
        }),
        'failed to delete storage file'
      )
      expect(ctx.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: hookError, documentId: 'doc-1' }),
        'afterDelete hook failed after document delete'
      )
    })
  })

  // -----------------------------------------------------------------------
  // updateDocumentSystemFields (audited, non-versioned)
  // -----------------------------------------------------------------------
  describe('updateDocumentSystemFields', () => {
    function setupDoc(getDocumentSystemFieldsForUpdate: any, overrides?: Record<string, any>) {
      getDocumentSystemFieldsForUpdate.mockResolvedValue({
        path: 'old-slug',
        source_locale: 'en',
        availableLocales: ['en'],
        ...overrides,
      })
    }

    it('records document.path.changed when the path actually changes', async () => {
      const { db, getDocumentSystemFieldsForUpdate, auditAppend, withTransaction } = createMockDb()
      setupDoc(getDocumentSystemFieldsForUpdate)
      const ctx = buildCtx(db)

      const result = await updateDocumentSystemFields(ctx, {
        documentId: 'doc-1',
        path: 'new-slug',
      })

      expect(withTransaction).toHaveBeenCalledOnce()
      expect(result).toMatchObject({
        changed: true,
        pathChanged: true,
        availableLocalesChanged: false,
        path: 'new-slug',
      })
      expect(auditAppend).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'document.path.changed',
          field: 'path',
          before: 'old-slug',
          after: 'new-slug',
        })
      )
    })

    it('does not write, audit, or fire the hook when the path is unchanged', async () => {
      const { db, getDocumentSystemFieldsForUpdate, auditAppend, withTransaction } = createMockDb()
      setupDoc(getDocumentSystemFieldsForUpdate)
      const afterSystemFieldsChange = vi.fn()
      const ctx = buildCtx(db, {
        ...minimalCollection,
        hooks: { afterSystemFieldsChange },
      })

      const result = await updateDocumentSystemFields(ctx, {
        documentId: 'doc-1',
        path: 'old-slug',
      })

      expect(result).toMatchObject({ changed: false, pathChanged: false })
      expect(db.commands.documents.updateDocumentPath).not.toHaveBeenCalled()
      expect(withTransaction).toHaveBeenCalledOnce()
      expect(auditAppend).not.toHaveBeenCalled()
      expect(afterSystemFieldsChange).not.toHaveBeenCalled()
    })

    it('records document.locales.changed with before/after sets', async () => {
      const { db, getDocumentSystemFieldsForUpdate, auditAppend } = createMockDb()
      setupDoc(getDocumentSystemFieldsForUpdate)
      const ctx = buildCtx(db)

      const result = await updateDocumentSystemFields(ctx, {
        documentId: 'doc-1',
        availableLocales: ['en', 'fr'],
      })

      expect(result).toMatchObject({
        changed: true,
        pathChanged: false,
        availableLocalesChanged: true,
        availableLocalesWritten: true,
      })
      expect(auditAppend).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'document.locales.changed',
          field: 'availableLocales',
          before: ['en'],
          after: ['en', 'fr'],
        })
      )
    })

    it('treats reordered and duplicated locale values as a no-op set', async () => {
      const { db, getDocumentSystemFieldsForUpdate, auditAppend, withTransaction } = createMockDb()
      setupDoc(getDocumentSystemFieldsForUpdate, { availableLocales: ['en', 'fr'] })
      const afterSystemFieldsChange = vi.fn()
      const ctx = buildCtx(db, {
        ...minimalCollection,
        hooks: { afterSystemFieldsChange },
      })

      const result = await updateDocumentSystemFields(ctx, {
        documentId: 'doc-1',
        availableLocales: ['fr', 'en', 'fr'],
      })

      expect(result).toMatchObject({ changed: false, availableLocalesChanged: false })
      expect(db.commands.documents.setDocumentAvailableLocales).not.toHaveBeenCalled()
      expect(withTransaction).toHaveBeenCalledOnce()
      expect(auditAppend).not.toHaveBeenCalled()
      expect(afterSystemFieldsChange).not.toHaveBeenCalled()
    })

    it('fires ordered hooks after commit with previous and current field snapshots', async () => {
      const { db, getDocumentSystemFieldsForUpdate, auditAppend, withTransaction } = createMockDb()
      setupDoc(getDocumentSystemFieldsForUpdate)
      const order: string[] = []
      ;(db.commands.documents.updateDocumentPath as any).mockImplementation(async () => {
        order.push('path-write')
      })
      ;(db.commands.documents.setDocumentAvailableLocales as any).mockImplementation(async () => {
        order.push('locales-write')
      })
      auditAppend.mockImplementation(async () => {
        order.push('audit')
        return { id: 'audit-1' }
      })
      withTransaction.mockImplementation(async (fn) => {
        order.push('transaction:start')
        const value = await fn()
        order.push('transaction:commit')
        return value
      })
      const firstHook = vi.fn(async () => {
        order.push('hook:first')
      })
      const secondHook = vi.fn(async () => {
        order.push('hook:second')
      })
      const ctx = buildCtx(db, {
        ...minimalCollection,
        hooks: { afterSystemFieldsChange: [firstHook, secondHook] },
      })

      await updateDocumentSystemFields(ctx, {
        documentId: 'doc-1',
        path: 'new-slug',
        availableLocales: ['fr', 'en', 'fr'],
      })

      expect(order).toEqual([
        'transaction:start',
        'path-write',
        'audit',
        'locales-write',
        'audit',
        'transaction:commit',
        'hook:first',
        'hook:second',
      ])
      expect(firstHook).toHaveBeenCalledWith({
        documentId: 'doc-1',
        collectionPath: 'articles',
        requested: { path: true, availableLocales: true },
        changed: { path: true, availableLocales: true },
        reconciliation: false,
        previousPath: 'old-slug',
        currentPath: 'new-slug',
        previousAvailableLocales: ['en'],
        currentAvailableLocales: ['fr', 'en'],
      })
    })

    it('does not fire side-effect hooks when the audited transaction fails', async () => {
      const { db, getDocumentSystemFieldsForUpdate, auditAppend } = createMockDb()
      setupDoc(getDocumentSystemFieldsForUpdate)
      const afterSystemFieldsChange = vi.fn()
      auditAppend.mockRejectedValue(new Error('audit failed'))
      const ctx = buildCtx(db, {
        ...minimalCollection,
        hooks: { afterSystemFieldsChange },
      })

      await expect(
        updateDocumentSystemFields(ctx, { documentId: 'doc-1', path: 'new-slug' })
      ).rejects.toThrow('audit failed')

      expect(db.commands.documents.updateDocumentPath).toHaveBeenCalledOnce()
      expect(afterSystemFieldsChange).not.toHaveBeenCalled()
    })

    it('propagates an after-hook failure without folding it into the committed transaction', async () => {
      const { db, getDocumentSystemFieldsForUpdate, withTransaction } = createMockDb()
      setupDoc(getDocumentSystemFieldsForUpdate)
      let committed = false
      withTransaction.mockImplementation(async (fn) => {
        const value = await fn()
        committed = true
        return value
      })
      const afterSystemFieldsChange = vi.fn(async () => {
        expect(committed).toBe(true)
        throw new Error('cache unavailable')
      })
      const ctx = buildCtx(db, {
        ...minimalCollection,
        hooks: { afterSystemFieldsChange },
      })

      await expect(
        updateDocumentSystemFields(ctx, { documentId: 'doc-1', availableLocales: ['en', 'fr'] })
      ).rejects.toThrow('cache unavailable')

      expect(committed).toBe(true)
      expect(db.commands.documents.setDocumentAvailableLocales).toHaveBeenCalledOnce()
      expect(afterSystemFieldsChange).toHaveBeenCalledOnce()
    })

    it('re-runs reconciliation on an explicit no-op retry after a committed hook failure', async () => {
      const { db, getDocumentSystemFieldsForUpdate, auditAppend } = createMockDb()
      setupDoc(getDocumentSystemFieldsForUpdate)
      const afterSystemFieldsChange = vi
        .fn()
        .mockRejectedValueOnce(new Error('search unavailable'))
        .mockResolvedValue(undefined)
      const ctx = buildCtx(db, {
        ...minimalCollection,
        hooks: { afterSystemFieldsChange },
      })

      await expect(
        updateDocumentSystemFields(ctx, { documentId: 'doc-1', path: 'new-slug' })
      ).rejects.toThrow('search unavailable')

      setupDoc(getDocumentSystemFieldsForUpdate, { path: 'new-slug' })
      const retry = await updateDocumentSystemFields(ctx, {
        documentId: 'doc-1',
        path: 'new-slug',
        reconcile: true,
      })

      expect(retry).toMatchObject({ changed: false, reconciliation: true })
      expect(db.commands.documents.updateDocumentPath).toHaveBeenCalledOnce()
      expect(auditAppend).toHaveBeenCalledOnce()
      expect(afterSystemFieldsChange).toHaveBeenCalledTimes(2)
      expect(afterSystemFieldsChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          requested: { path: true, availableLocales: false },
          changed: { path: false, availableLocales: false },
          reconciliation: true,
          previousPath: 'new-slug',
          currentPath: 'new-slug',
        })
      )
    })

    it('uses the locked transaction snapshot for audit and invalidation payloads', async () => {
      const { db, getDocumentById, getDocumentSystemFieldsForUpdate, auditAppend } = createMockDb()
      getDocumentById.mockResolvedValue({
        path: 'stale-path',
        source_locale: 'en',
        availableLocales: ['en'],
      })
      setupDoc(getDocumentSystemFieldsForUpdate, {
        path: 'concurrent-path',
        availableLocales: ['en', 'fr'],
      })
      const afterSystemFieldsChange = vi.fn()
      const ctx = buildCtx(db, {
        ...minimalCollection,
        hooks: { afterSystemFieldsChange },
      })

      await updateDocumentSystemFields(ctx, {
        documentId: 'doc-1',
        path: 'final-path',
        availableLocales: ['de'],
      })

      expect(getDocumentById).not.toHaveBeenCalled()
      expect(auditAppend).toHaveBeenCalledWith(
        expect.objectContaining({ field: 'path', before: 'concurrent-path', after: 'final-path' })
      )
      expect(auditAppend).toHaveBeenCalledWith(
        expect.objectContaining({
          field: 'availableLocales',
          before: ['en', 'fr'],
          after: ['de'],
        })
      )
      expect(afterSystemFieldsChange).toHaveBeenCalledWith(
        expect.objectContaining({
          previousPath: 'concurrent-path',
          currentPath: 'final-path',
          previousAvailableLocales: ['en', 'fr'],
          currentAvailableLocales: ['de'],
        })
      )
    })
  })

  // -----------------------------------------------------------------------
  // restoreDocumentVersion
  // -----------------------------------------------------------------------
  describe('restoreDocumentVersion', () => {
    function setupRestore(opts?: {
      sourceFields?: Record<string, any>
      sourceDocumentId?: string
      currentVersionId?: string
      currentPath?: string
    }) {
      const sourceDocumentId = opts?.sourceDocumentId ?? 'doc-1'
      const currentVersionId = opts?.currentVersionId ?? 'ver-current'
      const sourceVersionId = 'ver-source'
      const currentPath = opts?.currentPath ?? 'sticky-path'
      const sourceFields = opts?.sourceFields ?? {
        title: { en: 'Old EN', fr: 'Vieux FR' },
      }

      const mocks = createMockDb()
      const { db } = mocks

      ;(db.queries.documents.getDocumentByVersion as any).mockResolvedValue({
        document_version_id: sourceVersionId,
        document_id: sourceDocumentId,
        path: 'long-ago-path',
        status: 'archived',
        fields: sourceFields,
      })
      mocks.getCurrentVersionMetadata.mockResolvedValue({
        document_version_id: currentVersionId,
        document_id: 'doc-1',
        collection_id: 'col-1',
        path: currentPath,
        status: 'published',
        created_at: new Date(),
        updated_at: new Date(),
      })
      mocks.getDocumentById.mockResolvedValue({
        document_version_id: currentVersionId,
        path: currentPath,
        status: 'published',
        fields: { title: 'Currently Published' },
      })
      mocks.createDocumentVersion.mockResolvedValue({
        document: { id: 'ver-restored', document_id: 'doc-1' },
        fieldCount: 5,
      })

      return { ...mocks, sourceVersionId, currentVersionId, sourceFields, currentPath }
    }

    it('reads the source with locale: "all" and re-emits via createDocumentVersion', async () => {
      const { db, createDocumentVersion, sourceVersionId, sourceFields, currentVersionId } =
        setupRestore()
      const ctx = buildCtx(db)

      const result = await restoreDocumentVersion(ctx, {
        documentId: 'doc-1',
        sourceVersionId,
      })

      expect(db.queries.documents.getDocumentByVersion).toHaveBeenCalledWith({
        document_version_id: sourceVersionId,
        locale: 'all',
      })
      expect(createDocumentVersion).toHaveBeenCalledOnce()
      const call = createDocumentVersion.mock.calls[0]?.[0]
      expect(call.action).toBe('restore')
      expect(call.locale).toBe('all')
      expect(call.documentData).toEqual(sourceFields)
      expect(call.previousVersionId).toBe(currentVersionId)
      expect(result).toEqual({
        documentId: 'doc-1',
        documentVersionId: 'ver-restored',
        sourceVersionId,
      })
    })

    it('hard-defaults the new version status to the workflow default (never inherits source status)', async () => {
      const { db, createDocumentVersion, sourceVersionId } = setupRestore()
      const ctx = buildCtx(db)

      await restoreDocumentVersion(ctx, { documentId: 'doc-1', sourceVersionId })

      // Source version was 'archived'; default status for minimalCollection is 'draft'.
      expect(createDocumentVersion.mock.calls[0]?.[0].status).toBe('draft')
    })

    it('does not pass path on restore — the existing path row is sticky', async () => {
      const { db, createDocumentVersion, sourceVersionId } = setupRestore({
        currentPath: 'sticky-path',
      })
      const ctx = buildCtx(db)

      await restoreDocumentVersion(ctx, { documentId: 'doc-1', sourceVersionId })

      // Restore never changes a document's path: the existing
      // byline_document_paths row carries forward unchanged. The storage
      // primitive only writes to document_paths when `path` is supplied.
      expect(createDocumentVersion.mock.calls[0]?.[0].path).toBeUndefined()
    })

    it('rejects when the source version belongs to a different document', async () => {
      const { db, sourceVersionId, createDocumentVersion } = setupRestore({
        sourceDocumentId: 'doc-OTHER',
      })
      const ctx = buildCtx(db)

      try {
        await restoreDocumentVersion(ctx, { documentId: 'doc-1', sourceVersionId })
        expect.fail('expected ERR_VALIDATION')
      } catch (err) {
        expect(err).toBeInstanceOf(BylineError)
        expect((err as BylineError).code).toBe(ErrorCodes.VALIDATION)
      }
      expect(createDocumentVersion).not.toHaveBeenCalled()
    })

    it('rejects when the source is already the current version', async () => {
      const sourceVersionId = 'ver-source'
      const mocks = createMockDb()
      const { db } = mocks
      ;(db.queries.documents.getDocumentByVersion as any).mockResolvedValue({
        document_version_id: sourceVersionId,
        document_id: 'doc-1',
        path: 'p',
        status: 'draft',
        fields: {},
      })
      mocks.getCurrentVersionMetadata.mockResolvedValue({
        document_version_id: sourceVersionId, // SAME as source
        document_id: 'doc-1',
        collection_id: 'col-1',
        path: 'p',
        status: 'draft',
        created_at: new Date(),
        updated_at: new Date(),
      })
      const ctx = buildCtx(db)

      try {
        await restoreDocumentVersion(ctx, { documentId: 'doc-1', sourceVersionId })
        expect.fail('expected ERR_INVALID_TRANSITION')
      } catch (err) {
        expect((err as BylineError).code).toBe(ErrorCodes.INVALID_TRANSITION)
      }
      expect(mocks.createDocumentVersion).not.toHaveBeenCalled()
    })

    it('fires beforeUpdate / afterUpdate with restore: { sourceVersionId } context', async () => {
      const beforeUpdate = vi.fn()
      const afterUpdate = vi.fn()
      const { db, sourceVersionId } = setupRestore()
      const definition = { ...minimalCollection, hooks: { beforeUpdate, afterUpdate } }
      const ctx = buildCtx(db, definition)

      await restoreDocumentVersion(ctx, { documentId: 'doc-1', sourceVersionId })

      expect(beforeUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          collectionPath: 'articles',
          restore: { sourceVersionId },
          originalData: expect.objectContaining({
            fields: expect.objectContaining({ title: 'Currently Published' }),
          }),
        })
      )
      expect(afterUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-1',
          documentVersionId: 'ver-restored',
          // Sticky path comes from the current version's envelope, not the source.
          path: 'sticky-path',
          restore: { sourceVersionId },
        })
      )
    })

    it('throws ERR_FORBIDDEN when actor lacks collections.<path>.update', async () => {
      const { db, sourceVersionId } = setupRestore()
      const ctx = buildCtx(db)
      const actor = new AdminAuth({
        id: 'editor',
        abilities: ['collections.articles.read'],
      })
      ctx.requestContext = createRequestContext({ actor })

      try {
        await restoreDocumentVersion(ctx, { documentId: 'doc-1', sourceVersionId })
        expect.fail('expected ERR_FORBIDDEN')
      } catch (err) {
        expect((err as AuthError).code).toBe(AuthErrorCodes.FORBIDDEN)
        expect((err as AuthError).message).toContain('collections.articles.update')
      }
    })

    it('permits restore when actor holds only collections.<path>.update (no separate restore verb needed)', async () => {
      const { db, createDocumentVersion, sourceVersionId } = setupRestore()
      const ctx = buildCtx(db)
      const actor = new AdminAuth({
        id: 'editor',
        abilities: ['collections.articles.update', 'collections.articles.read'],
      })
      ctx.requestContext = createRequestContext({ actor })

      await restoreDocumentVersion(ctx, { documentId: 'doc-1', sourceVersionId })
      expect(createDocumentVersion).toHaveBeenCalledOnce()
    })
  })

  // -----------------------------------------------------------------------
  // duplicateDocument
  // -----------------------------------------------------------------------
  describe('duplicateDocument', () => {
    /** Collection with a localized title (drives the per-locale suffix path). */
    const localizedCollection: CollectionDefinition = {
      path: 'articles',
      labels: { singular: 'Article', plural: 'Articles' },
      useAsTitle: 'title',
      useAsPath: 'title',
      fields: [
        { name: 'title', type: 'text', localized: true },
        { name: 'tagline', type: 'text' },
      ],
    }

    /** Helper: seed the source read with `locale: 'all'`. */
    function setupSource(
      mocks: ReturnType<typeof createMockDb>,
      opts?: {
        sourceFields?: Record<string, any>
        sourceDocumentId?: string
      }
    ) {
      const sourceDocumentId = opts?.sourceDocumentId ?? 'doc-source'
      const sourceFields = opts?.sourceFields ?? {
        title: { en: 'Hello', fr: 'Bonjour' },
        tagline: 'A tagline',
      }
      mocks.getDocumentById.mockResolvedValue({
        document_version_id: 'ver-source',
        document_id: sourceDocumentId,
        path: 'hello',
        status: 'draft',
        created_at: new Date(),
        updated_at: new Date(),
        fields: sourceFields,
      })
      mocks.createDocumentVersion.mockResolvedValue({
        document: { id: 'ver-new', document_id: 'doc-new' },
        fieldCount: 5,
      })
      return { sourceDocumentId, sourceFields }
    }

    it('reads the source with locale: "all" and writes via createDocumentVersion with locale: "all", action: "create", no documentId', async () => {
      const mocks = createMockDb()
      const { sourceDocumentId } = setupSource(mocks)
      const ctx = buildCtx(mocks.db, localizedCollection)

      const result = await duplicateDocument(ctx, { sourceDocumentId })

      expect(mocks.getDocumentById).toHaveBeenCalledWith(
        expect.objectContaining({
          collection_id: 'col-1',
          document_id: sourceDocumentId,
          locale: 'all',
          reconstruct: true,
          lenient: true,
        })
      )
      expect(mocks.createDocumentVersion).toHaveBeenCalledOnce()
      const call = mocks.createDocumentVersion.mock.calls[0]?.[0]
      expect(call.action).toBe('create')
      expect(call.locale).toBe('all')
      expect(call.documentId).toBeUndefined()
      expect(result.documentId).toBe('doc-new')
      expect(result.documentVersionId).toBe('ver-new')
      expect(result.sourceDocumentId).toBe(sourceDocumentId)
      expect(result.pathRetried).toBe(false)
    })

    it('appends " (copy)" to every locale of a localized useAsTitle field', async () => {
      const mocks = createMockDb()
      setupSource(mocks, {
        sourceFields: {
          title: { en: 'Hello', fr: 'Bonjour' },
          tagline: 'A tagline',
        },
      })
      const ctx = buildCtx(mocks.db, localizedCollection)

      await duplicateDocument(ctx, { sourceDocumentId: 'doc-source' })

      const call = mocks.createDocumentVersion.mock.calls[0]?.[0]
      expect(call.documentData.title).toEqual({
        en: 'Hello (copy)',
        fr: 'Bonjour (copy)',
      })
      // Non-title fields pass through untouched.
      expect(call.documentData.tagline).toBe('A tagline')
    })

    it('appends " (copy)" once to a non-localized useAsTitle field', async () => {
      const nonLocalizedCollection: CollectionDefinition = {
        ...localizedCollection,
        fields: [
          { name: 'title', type: 'text' },
          { name: 'tagline', type: 'text' },
        ],
      }
      const mocks = createMockDb()
      setupSource(mocks, {
        sourceFields: {
          title: 'Hello',
          tagline: 'A tagline',
        },
      })
      const ctx = buildCtx(mocks.db, nonLocalizedCollection)

      await duplicateDocument(ctx, { sourceDocumentId: 'doc-source' })

      const call = mocks.createDocumentVersion.mock.calls[0]?.[0]
      expect(call.documentData.title).toBe('Hello (copy)')
    })

    it('derives the candidate path from the default-locale suffixed title', async () => {
      const mocks = createMockDb()
      setupSource(mocks, {
        sourceFields: {
          title: { en: 'Hello World', fr: 'Bonjour Monde' },
          tagline: 'A tagline',
        },
      })
      const ctx = buildCtx(mocks.db, localizedCollection)

      const result = await duplicateDocument(ctx, { sourceDocumentId: 'doc-source' })

      const call = mocks.createDocumentVersion.mock.calls[0]?.[0]
      // Default locale is 'en'; "Hello World (copy)" slugifies to "hello-world-copy".
      expect(call.path).toBe('hello-world-copy')
      expect(result.newPath).toBe('hello-world-copy')
    })

    it('strips _id and _type metadata from blocks and array items so the new doc gets fresh identities', async () => {
      const mocks = createMockDb()
      setupSource(mocks, {
        sourceFields: {
          title: { en: 'Hello', fr: 'Bonjour' },
          tagline: 'A tagline',
          sections: [
            {
              _id: 'section-id-1',
              _type: 'section',
              heading: 'Intro',
              blocks: [
                { _id: 'block-id-1', _type: 'photoBlock', display: 'wide' },
                { _id: 'block-id-2', _type: 'textBlock', body: 'inner' },
              ],
            },
          ],
        },
      })
      const ctx = buildCtx(mocks.db, localizedCollection)

      await duplicateDocument(ctx, { sourceDocumentId: 'doc-source' })

      const call = mocks.createDocumentVersion.mock.calls[0]?.[0]
      const sections = call.documentData.sections as any[]
      expect(sections[0]._id).toBeUndefined()
      expect(sections[0]._type).toBeUndefined()
      expect(sections[0].blocks[0]._id).toBeUndefined()
      expect(sections[0].blocks[1]._id).toBeUndefined()
      // Content survives — only meta is stripped.
      expect(sections[0].heading).toBe('Intro')
      expect(sections[0].blocks[0].display).toBe('wide')
    })

    it('does not mutate the source object returned by getDocumentById (deep-clones before suffix / strip)', async () => {
      const originalFields = {
        title: { en: 'Hello', fr: 'Bonjour' },
        tagline: 'A tagline',
        sections: [{ _id: 'sec-1', heading: 'Intro' }],
      }
      const mocks = createMockDb()
      mocks.getDocumentById.mockResolvedValue({
        document_version_id: 'ver-source',
        document_id: 'doc-source',
        path: 'hello',
        status: 'draft',
        created_at: new Date(),
        updated_at: new Date(),
        fields: originalFields,
      })
      mocks.createDocumentVersion.mockResolvedValue({
        document: { id: 'ver-new', document_id: 'doc-new' },
        fieldCount: 5,
      })
      const ctx = buildCtx(mocks.db, localizedCollection)

      await duplicateDocument(ctx, { sourceDocumentId: 'doc-source' })

      // Source title should be unchanged in memory.
      expect(originalFields.title).toEqual({ en: 'Hello', fr: 'Bonjour' })
      expect(originalFields.sections[0]?._id).toBe('sec-1')
    })

    it('retries once with a short-UUID suffix when the candidate path collides', async () => {
      const mocks = createMockDb()
      setupSource(mocks)
      const ctx = buildCtx(mocks.db, localizedCollection)

      // First call: throw a path-conflict error. Second call: succeed.
      let attempt = 0
      mocks.createDocumentVersion.mockImplementation(() => {
        attempt += 1
        if (attempt === 1) {
          const err = ERR_PATH_CONFLICT({ message: 'path conflict' })
          return Promise.reject(err)
        }
        return Promise.resolve({
          document: { id: 'ver-new', document_id: 'doc-new' },
          fieldCount: 5,
        })
      })

      const result = await duplicateDocument(ctx, { sourceDocumentId: 'doc-source' })

      expect(mocks.createDocumentVersion).toHaveBeenCalledTimes(2)
      const firstPath = mocks.createDocumentVersion.mock.calls[0]?.[0].path as string
      const retryPath = mocks.createDocumentVersion.mock.calls[1]?.[0].path as string
      expect(retryPath.startsWith(`${firstPath}-`)).toBe(true)
      // 4-char UUID slice
      expect(retryPath.length).toBe(firstPath.length + 5)
      expect(result.pathRetried).toBe(true)
      expect(result.newPath).toBe(retryPath)
    })

    it('only retries once — a second conflict propagates to the caller', async () => {
      const mocks = createMockDb()
      setupSource(mocks)
      const ctx = buildCtx(mocks.db, localizedCollection)

      // Both attempts throw path-conflict.
      mocks.createDocumentVersion.mockImplementation(() => {
        return Promise.reject(ERR_PATH_CONFLICT({ message: 'path conflict' }))
      })

      await expect(
        duplicateDocument(ctx, { sourceDocumentId: 'doc-source' })
      ).rejects.toMatchObject({ code: ErrorCodes.PATH_CONFLICT })
      // Bounded to exactly two attempts.
      expect(mocks.createDocumentVersion).toHaveBeenCalledTimes(2)
    })

    it('throws ERR_NOT_FOUND when the source document does not exist', async () => {
      const mocks = createMockDb()
      mocks.getDocumentById.mockResolvedValue(null)
      const ctx = buildCtx(mocks.db, localizedCollection)

      try {
        await duplicateDocument(ctx, { sourceDocumentId: 'doc-missing' })
        expect.fail('expected ERR_NOT_FOUND')
      } catch (err) {
        expect((err as BylineError).code).toBe(ErrorCodes.NOT_FOUND)
      }
      expect(mocks.createDocumentVersion).not.toHaveBeenCalled()
    })

    it('fires beforeCreate / afterCreate hooks with a duplicate marker', async () => {
      const beforeCreate = vi.fn()
      const afterCreate = vi.fn()
      const withHooks: CollectionDefinition = {
        ...localizedCollection,
        hooks: {
          beforeCreate,
          afterCreate,
        },
      }
      const mocks = createMockDb()
      setupSource(mocks, { sourceDocumentId: 'doc-source' })
      const ctx = buildCtx(mocks.db, withHooks)

      await duplicateDocument(ctx, { sourceDocumentId: 'doc-source' })

      expect(beforeCreate).toHaveBeenCalledOnce()
      const beforeCtx = beforeCreate.mock.calls[0]?.[0]
      expect(beforeCtx.duplicate).toEqual({ sourceDocumentId: 'doc-source' })
      expect(beforeCtx.collectionPath).toBe('articles')
      // Hook sees the multi-locale shape (mirrors restoreDocumentVersion's
      // multi-locale-data precedent on beforeUpdate).
      expect(beforeCtx.data.title).toEqual({ en: 'Hello (copy)', fr: 'Bonjour (copy)' })

      expect(afterCreate).toHaveBeenCalledOnce()
      const afterCtx = afterCreate.mock.calls[0]?.[0]
      expect(afterCtx.duplicate).toEqual({ sourceDocumentId: 'doc-source' })
      expect(afterCtx.documentId).toBe('doc-new')
      expect(afterCtx.documentVersionId).toBe('ver-new')
      // afterCreate carries the final path written for the duplicate — the
      // same value handed to createDocumentVersion.
      const writtenPath = mocks.createDocumentVersion.mock.calls[0]?.[0]?.path
      expect(typeof afterCtx.path).toBe('string')
      expect(afterCtx.path).toBe(writtenPath)
    })

    it('enforces collections.<path>.create — rejects an admin actor missing the ability', async () => {
      const mocks = createMockDb()
      setupSource(mocks)
      const ctx = buildCtx(mocks.db, localizedCollection)
      // Replace super-admin with an admin who only has read.
      const actor = new AdminAuth({
        id: 'reader',
        abilities: ['collections.articles.read'],
      })
      ctx.requestContext = createRequestContext({ actor })

      try {
        await duplicateDocument(ctx, { sourceDocumentId: 'doc-source' })
        expect.fail('expected ERR_FORBIDDEN')
      } catch (err) {
        expect((err as AuthError).code).toBe(AuthErrorCodes.FORBIDDEN)
        expect((err as AuthError).message).toContain('collections.articles.create')
      }
      expect(mocks.createDocumentVersion).not.toHaveBeenCalled()
    })

    it('rejects when requestContext is absent (ERR_UNAUTHENTICATED)', async () => {
      const mocks = createMockDb()
      setupSource(mocks)
      const ctx = buildCtx(mocks.db, localizedCollection)
      ;(ctx as any).requestContext = undefined

      try {
        await duplicateDocument(ctx, { sourceDocumentId: 'doc-source' })
        expect.fail('expected ERR_UNAUTHENTICATED')
      } catch (err) {
        expect((err as AuthError).code).toBe(AuthErrorCodes.UNAUTHENTICATED)
      }
      expect(mocks.createDocumentVersion).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // copyToLocale
  // -----------------------------------------------------------------------
  describe('copyToLocale', () => {
    /** Collection with mixed localized / non-localized fields, including
     *  nested structure (array of groups, blocks). */
    const mixedCollection: CollectionDefinition = {
      path: 'articles',
      labels: { singular: 'Article', plural: 'Articles' },
      useAsTitle: 'title',
      fields: [
        { name: 'title', type: 'text', localized: true },
        { name: 'tagline', type: 'text', localized: true },
        { name: 'sku', type: 'text' /* non-localized */ },
        {
          name: 'sections',
          type: 'array',
          fields: [
            { name: 'heading', type: 'text', localized: true },
            { name: 'order', type: 'integer' /* non-localized */ },
          ],
        },
      ],
    }

    function setupSourceTarget(opts?: {
      sourceFields?: Record<string, any>
      targetFields?: Record<string, any>
      currentVersionId?: string
    }) {
      const mocks = createMockDb()
      const sourceFields = opts?.sourceFields ?? {
        title: 'Hello',
        tagline: 'World',
        sku: 'SKU-1',
        sections: [{ _id: 'sec-1', heading: 'Intro', order: 1 }],
      }
      const targetFields = opts?.targetFields ?? {
        title: '',
        tagline: 'Already translated',
        sku: 'SKU-1',
        sections: [{ _id: 'sec-1', heading: '', order: 1 }],
      }
      const currentVersionId = opts?.currentVersionId ?? 'ver-current'

      mocks.getDocumentById.mockImplementation(
        async (params: { locale?: string }): Promise<any> => {
          if (params.locale === 'en') {
            return {
              document_version_id: currentVersionId,
              document_id: 'doc-1',
              path: 'hello',
              status: 'draft',
              fields: sourceFields,
            }
          }
          if (params.locale === 'fr') {
            return {
              document_version_id: currentVersionId,
              document_id: 'doc-1',
              path: 'hello',
              status: 'draft',
              fields: targetFields,
            }
          }
          return null
        }
      )
      mocks.createDocumentVersion.mockResolvedValue({
        document: { id: 'ver-new', document_id: 'doc-1' },
        fieldCount: 5,
      })

      return { mocks, sourceFields, targetFields, currentVersionId }
    }

    it('reads both source and target locales, writes target with action="copy_to_locale", locale=target, previousVersionId threaded', async () => {
      const { mocks, currentVersionId } = setupSourceTarget()
      const ctx = buildCtx(mocks.db, mixedCollection)

      const result = await copyToLocale(ctx, {
        documentId: 'doc-1',
        sourceLocale: 'en',
        targetLocale: 'fr',
        overwrite: false,
      })

      // Source + target read.
      const readCalls = mocks.getDocumentById.mock.calls.map((c) => c[0])
      expect(readCalls.some((p: any) => p.locale === 'en')).toBe(true)
      expect(readCalls.some((p: any) => p.locale === 'fr')).toBe(true)

      // Single write to target locale.
      expect(mocks.createDocumentVersion).toHaveBeenCalledOnce()
      const writeCall = mocks.createDocumentVersion.mock.calls[0]?.[0]
      expect(writeCall.action).toBe('copy_to_locale')
      expect(writeCall.locale).toBe('fr')
      expect(writeCall.documentId).toBe('doc-1')
      expect(writeCall.previousVersionId).toBe(currentVersionId)
      expect(writeCall.path).toBeUndefined()

      // Result envelope.
      expect(result.documentId).toBe('doc-1')
      expect(result.sourceLocale).toBe('en')
      expect(result.targetLocale).toBe('fr')
    })

    it('overwrite=false: fills empty target slots from source, preserves populated target slots, never touches non-localized fields', async () => {
      const { mocks } = setupSourceTarget({
        sourceFields: {
          title: 'EN Title',
          tagline: 'EN Tagline',
          sku: 'SKU-EN',
          sections: [{ _id: 'sec-1', heading: 'EN Heading', order: 5 }],
        },
        targetFields: {
          title: '', // empty → should be filled
          tagline: 'FR Tagline Already', // populated → should be kept
          sku: 'SKU-FR', // non-localized, target value preserved
          sections: [{ _id: 'sec-1', heading: '', order: 9 }],
        },
      })
      const ctx = buildCtx(mocks.db, mixedCollection)

      const result = await copyToLocale(ctx, {
        documentId: 'doc-1',
        sourceLocale: 'en',
        targetLocale: 'fr',
        overwrite: false,
      })

      const data = mocks.createDocumentVersion.mock.calls[0]?.[0].documentData
      expect(data.title).toBe('EN Title') // filled
      expect(data.tagline).toBe('FR Tagline Already') // kept
      expect(data.sku).toBe('SKU-FR') // non-localized: target preserved
      expect(data.sections[0].heading).toBe('EN Heading') // filled
      expect(data.sections[0].order).toBe(9) // non-localized: target preserved
      expect(data.sections[0]._id).toBe('sec-1') // identity preserved
      expect(result.fieldsUpdated).toBe(2) // title + sections[0].heading
    })

    it('overwrite=true: replaces every localized leaf with source value, even when source is empty', async () => {
      const { mocks } = setupSourceTarget({
        sourceFields: {
          title: 'EN Title',
          tagline: '', // empty source
          sku: 'SKU-EN',
          sections: [{ _id: 'sec-1', heading: 'EN Heading', order: 5 }],
        },
        targetFields: {
          title: 'FR Title',
          tagline: 'FR Tagline',
          sku: 'SKU-FR',
          sections: [{ _id: 'sec-1', heading: 'FR Heading', order: 9 }],
        },
      })
      const ctx = buildCtx(mocks.db, mixedCollection)

      await copyToLocale(ctx, {
        documentId: 'doc-1',
        sourceLocale: 'en',
        targetLocale: 'fr',
        overwrite: true,
      })

      const data = mocks.createDocumentVersion.mock.calls[0]?.[0].documentData
      expect(data.title).toBe('EN Title') // overwritten
      expect(data.tagline).toBe('') // overwritten even though source is empty
      expect(data.sku).toBe('SKU-FR') // non-localized: still target preserved
      expect(data.sections[0].heading).toBe('EN Heading') // overwritten
      expect(data.sections[0].order).toBe(9) // non-localized preserved
    })

    it('does not pass `path` — path is sticky on copy-to-locale', async () => {
      const { mocks } = setupSourceTarget()
      const ctx = buildCtx(mocks.db, mixedCollection)
      await copyToLocale(ctx, {
        documentId: 'doc-1',
        sourceLocale: 'en',
        targetLocale: 'fr',
        overwrite: false,
      })
      expect(mocks.createDocumentVersion.mock.calls[0]?.[0].path).toBeUndefined()
    })

    it('rejects when sourceLocale === targetLocale (ERR_VALIDATION)', async () => {
      const { mocks } = setupSourceTarget()
      const ctx = buildCtx(mocks.db, mixedCollection)

      try {
        await copyToLocale(ctx, {
          documentId: 'doc-1',
          sourceLocale: 'en',
          targetLocale: 'en',
          overwrite: false,
        })
        expect.fail('expected ERR_VALIDATION')
      } catch (err) {
        expect((err as BylineError).code).toBe(ErrorCodes.VALIDATION)
      }
      expect(mocks.createDocumentVersion).not.toHaveBeenCalled()
    })

    it('throws ERR_NOT_FOUND when the source-locale read returns null', async () => {
      const mocks = createMockDb()
      mocks.getDocumentById.mockResolvedValue(null) // both reads fail
      const ctx = buildCtx(mocks.db, mixedCollection)

      try {
        await copyToLocale(ctx, {
          documentId: 'doc-1',
          sourceLocale: 'en',
          targetLocale: 'fr',
          overwrite: false,
        })
        expect.fail('expected ERR_NOT_FOUND')
      } catch (err) {
        expect((err as BylineError).code).toBe(ErrorCodes.NOT_FOUND)
      }
      expect(mocks.createDocumentVersion).not.toHaveBeenCalled()
    })

    it('throws ERR_NOT_FOUND when the target-locale read returns null', async () => {
      const mocks = createMockDb()
      // Source returns a doc; target returns null.
      mocks.getDocumentById.mockImplementation(
        async (params: { locale?: string }): Promise<any> => {
          if (params.locale === 'en') {
            return {
              document_version_id: 'ver-current',
              document_id: 'doc-1',
              path: 'hello',
              status: 'draft',
              fields: { title: 'EN Title' },
            }
          }
          return null
        }
      )
      const ctx = buildCtx(mocks.db, mixedCollection)

      try {
        await copyToLocale(ctx, {
          documentId: 'doc-1',
          sourceLocale: 'en',
          targetLocale: 'fr',
          overwrite: false,
        })
        expect.fail('expected ERR_NOT_FOUND')
      } catch (err) {
        expect((err as BylineError).code).toBe(ErrorCodes.NOT_FOUND)
      }
      expect(mocks.createDocumentVersion).not.toHaveBeenCalled()
    })

    it('fires beforeUpdate / afterUpdate with the copyToLocale discriminator', async () => {
      const beforeUpdate = vi.fn()
      const afterUpdate = vi.fn()
      const withHooks: CollectionDefinition = {
        ...mixedCollection,
        hooks: { beforeUpdate, afterUpdate },
      }
      const { mocks } = setupSourceTarget()
      const ctx = buildCtx(mocks.db, withHooks)

      await copyToLocale(ctx, {
        documentId: 'doc-1',
        sourceLocale: 'en',
        targetLocale: 'fr',
        overwrite: false,
      })

      expect(beforeUpdate).toHaveBeenCalledOnce()
      expect(beforeUpdate.mock.calls[0]?.[0].copyToLocale).toEqual({
        sourceLocale: 'en',
        targetLocale: 'fr',
      })
      expect(afterUpdate).toHaveBeenCalledOnce()
      expect(afterUpdate.mock.calls[0]?.[0].copyToLocale).toEqual({
        sourceLocale: 'en',
        targetLocale: 'fr',
      })
      // Sticky path read off the target-locale envelope.
      expect(afterUpdate.mock.calls[0]?.[0].path).toBe('hello')
    })

    it('enforces collections.<path>.update — rejects an admin actor missing the ability', async () => {
      const { mocks } = setupSourceTarget()
      const ctx = buildCtx(mocks.db, mixedCollection)
      const actor = new AdminAuth({
        id: 'reader',
        abilities: ['collections.articles.read'],
      })
      ctx.requestContext = createRequestContext({ actor })

      try {
        await copyToLocale(ctx, {
          documentId: 'doc-1',
          sourceLocale: 'en',
          targetLocale: 'fr',
          overwrite: false,
        })
        expect.fail('expected ERR_FORBIDDEN')
      } catch (err) {
        expect((err as AuthError).code).toBe(AuthErrorCodes.FORBIDDEN)
        expect((err as AuthError).message).toContain('collections.articles.update')
      }
      expect(mocks.createDocumentVersion).not.toHaveBeenCalled()
    })

    it('rejects when requestContext is absent (ERR_UNAUTHENTICATED)', async () => {
      const { mocks } = setupSourceTarget()
      const ctx = buildCtx(mocks.db, mixedCollection)
      ;(ctx as any).requestContext = undefined

      try {
        await copyToLocale(ctx, {
          documentId: 'doc-1',
          sourceLocale: 'en',
          targetLocale: 'fr',
          overwrite: false,
        })
        expect.fail('expected ERR_UNAUTHENTICATED')
      } catch (err) {
        expect((err as AuthError).code).toBe(AuthErrorCodes.UNAUTHENTICATED)
      }
      expect(mocks.createDocumentVersion).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // Ability enforcement (Phase 4)
  // -----------------------------------------------------------------------
  describe('ability enforcement', () => {
    it('throws ERR_UNAUTHENTICATED when requestContext is absent', async () => {
      const { db } = createMockDb()
      const ctx = buildCtx(db)
      // Remove the default super-admin context to simulate a caller that
      // forgot to wire auth at all.
      ;(ctx as any).requestContext = undefined

      try {
        await createDocument(ctx, { data: { title: 'Oops' } })
        expect.fail('expected ERR_UNAUTHENTICATED')
      } catch (err) {
        expect(err).toBeInstanceOf(AuthError)
        expect((err as AuthError).code).toBe(AuthErrorCodes.UNAUTHENTICATED)
      }
    })

    it('throws ERR_FORBIDDEN when actor lacks collections.<path>.create', async () => {
      const { db } = createMockDb()
      const ctx = buildCtx(db)
      const actor = new AdminAuth({ id: 'editor', abilities: ['collections.articles.read'] })
      ctx.requestContext = createRequestContext({ actor })

      try {
        await createDocument(ctx, { data: { title: 'Nope' } })
        expect.fail('expected ERR_FORBIDDEN')
      } catch (err) {
        expect((err as AuthError).code).toBe(AuthErrorCodes.FORBIDDEN)
      }
    })

    it('permits create when actor holds collections.<path>.create', async () => {
      const { db, createDocumentVersion } = createMockDb()
      const ctx = buildCtx(db)
      const actor = new AdminAuth({
        id: 'editor',
        abilities: ['collections.articles.create'],
      })
      ctx.requestContext = createRequestContext({ actor })

      await createDocument(ctx, { data: { title: 'Yes' } })
      expect(createDocumentVersion).toHaveBeenCalledOnce()
    })

    it('requires both changeStatus and publish when transitioning to published', async () => {
      const { db, getCurrentVersionMetadata } = createMockDb()
      getCurrentVersionMetadata.mockResolvedValue({
        document_version_id: 'ver-1',
        document_id: 'doc-1',
        collection_id: 'col-1',
        path: 'x',
        status: 'draft',
        created_at: new Date(),
        updated_at: new Date(),
      })
      const ctx = buildCtx(db)
      const actor = new AdminAuth({
        id: 'editor',
        // Has changeStatus but NOT publish — the publish transition should fail.
        abilities: ['collections.articles.changeStatus'],
      })
      ctx.requestContext = createRequestContext({ actor })

      try {
        await changeDocumentStatus(ctx, { documentId: 'doc-1', nextStatus: 'published' })
        expect.fail('expected ERR_FORBIDDEN')
      } catch (err) {
        expect((err as AuthError).code).toBe(AuthErrorCodes.FORBIDDEN)
        expect((err as AuthError).message).toContain('collections.articles.publish')
      }
    })

    it('permits a non-publish transition with only the changeStatus ability', async () => {
      const { db, getCurrentVersionMetadata, setDocumentStatus } = createMockDb()
      getCurrentVersionMetadata.mockResolvedValue({
        document_version_id: 'ver-1',
        document_id: 'doc-1',
        collection_id: 'col-1',
        path: 'x',
        status: 'draft',
        created_at: new Date(),
        updated_at: new Date(),
      })
      const definition: CollectionDefinition = {
        ...minimalCollection,
        workflow: {
          statuses: [
            { name: 'draft' },
            { name: 'in_review' },
            { name: 'published' },
            { name: 'archived' },
          ],
        },
      }
      const ctx = buildCtx(db, definition)
      const actor = new AdminAuth({
        id: 'editor',
        abilities: ['collections.articles.changeStatus'],
      })
      ctx.requestContext = createRequestContext({ actor })

      await changeDocumentStatus(ctx, { documentId: 'doc-1', nextStatus: 'in_review' })
      expect(setDocumentStatus).toHaveBeenCalledOnce()
    })

    it('super-admin bypasses every check', async () => {
      const { db, createDocumentVersion } = createMockDb()
      const ctx = buildCtx(db)
      // buildCtx already defaults to super-admin; confirm no ability grants
      // are actually needed.
      await createDocument(ctx, { data: { title: 'X' } })
      expect(createDocumentVersion).toHaveBeenCalledOnce()
    })

    it('enforces delete against collections.<path>.delete', async () => {
      const { db, getDocumentById } = createMockDb()
      getDocumentById.mockResolvedValue({
        document_version_id: 'ver-1',
        document_id: 'doc-1',
        fields: {},
      })
      const ctx = buildCtx(db)
      const actor = new AdminAuth({
        id: 'editor',
        abilities: ['collections.articles.read', 'collections.articles.update'],
      })
      ctx.requestContext = createRequestContext({ actor })

      try {
        await deleteDocument(ctx, { documentId: 'doc-1' })
        expect.fail('expected ERR_FORBIDDEN')
      } catch (err) {
        expect((err as AuthError).code).toBe(AuthErrorCodes.FORBIDDEN)
        expect((err as AuthError).message).toContain('collections.articles.delete')
      }
    })
  })
})
