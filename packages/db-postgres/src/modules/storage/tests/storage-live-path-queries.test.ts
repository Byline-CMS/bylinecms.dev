/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition } from '@byline/core'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { documentPaths, documents, documentVersions } from '../../../database/schema/index.js'
import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'

const timestamp = Date.now()

const PagesCollectionConfig: CollectionDefinition = {
  path: `live-path-queries-${timestamp}`,
  labels: { singular: 'Page', plural: 'Pages' },
  fields: [{ name: 'title', type: 'text' }],
}

describe('live-path query resolution (PostgreSQL)', () => {
  let testDb: ReturnType<typeof setupTestDB>
  let collectionId: string

  beforeAll(async () => {
    testDb = setupTestDB([PagesCollectionConfig])
    const [collection] = await testDb.commandBuilders.collections.create(
      PagesCollectionConfig.path,
      PagesCollectionConfig
    )
    if (collection == null) throw new Error('failed to create live-path test collection')
    collectionId = collection.id
  })

  afterAll(async () => {
    await testDb.commandBuilders.collections.delete(collectionId)
    await teardownTestDB()
  })

  it('skips a deleted requested-locale row and projects it only for known-document history', async () => {
    const path = `shared-${timestamp}`
    const deleted = await testDb.commandBuilders.documents.createDocumentVersion({
      collectionId,
      collectionVersion: 1,
      collectionConfig: PagesCollectionConfig,
      action: 'create',
      documentData: { title: 'Former French occupant' },
      path: `former-source-${timestamp}`,
      locale: 'all',
      status: 'draft',
    })
    const deletedDocumentId = deleted.document.document_id

    await testDb.commandBuilders.documents.updateDocumentPath({
      documentId: deletedDocumentId,
      collectionId,
      locale: 'fr',
      path,
    })
    await testDb.commandBuilders.documents.createDocumentVersion({
      documentId: deletedDocumentId,
      collectionId,
      collectionVersion: 1,
      collectionConfig: PagesCollectionConfig,
      action: 'update',
      documentData: { title: 'Former French occupant, revised' },
      locale: 'all',
      status: 'draft',
      previousVersionId: deleted.document.id,
    })
    await testDb.commandBuilders.documents.softDeleteDocument({
      document_id: deletedDocumentId,
    })

    const pathRows = await testDb.db
      .select({
        deletedAt: documentPaths.deleted_at,
        updatedAt: documentPaths.updated_at,
      })
      .from(documentPaths)
      .where(eq(documentPaths.document_id, deletedDocumentId))
    expect(pathRows).toHaveLength(2)
    const deletedAt = pathRows[0]?.deletedAt
    expect(deletedAt).toBeInstanceOf(Date)
    expect(pathRows.every((row) => row.deletedAt?.getTime() === deletedAt?.getTime())).toBe(true)
    expect(pathRows.every((row) => row.updatedAt.getTime() === deletedAt?.getTime())).toBe(true)

    const versionRows = await testDb.db
      .select({
        isDeleted: documentVersions.is_deleted,
        updatedAt: documentVersions.updated_at,
      })
      .from(documentVersions)
      .where(eq(documentVersions.document_id, deletedDocumentId))
    expect(versionRows).toHaveLength(2)
    expect(versionRows.every((row) => row.isDeleted)).toBe(true)
    expect(versionRows.every((row) => row.updatedAt.getTime() === deletedAt?.getTime())).toBe(true)

    const live = await testDb.commandBuilders.documents.createDocumentVersion({
      collectionId,
      collectionVersion: 1,
      collectionConfig: PagesCollectionConfig,
      action: 'create',
      documentData: { title: 'Live English fallback' },
      path,
      locale: 'all',
      status: 'draft',
    })

    const found = await testDb.queryBuilders.documents.getDocumentByPath({
      collection_id: collectionId,
      path,
      locale: 'fr',
      reconstruct: false,
    })
    expect(found?.document_id).toBe(live.document.document_id)
    expect(found?.path).toBe(path)
    expect(found).not.toHaveProperty('deleted_at')
    expect(found).not.toHaveProperty('alive')

    const history = await testDb.queryBuilders.documents.getDocumentHistory({
      collection_id: collectionId,
      document_id: deletedDocumentId,
      locale: 'fr',
    })
    expect(history.documents).toHaveLength(2)
    expect(history.documents[0]?.path).toBe(path)
  })

  it('restores every tombstone atomically and leaves a legacy partial state untouched', async () => {
    const originalPath = `restore-source-${timestamp}`
    const frenchPath = `restore-fr-${timestamp}`
    const first = await testDb.commandBuilders.documents.createDocumentVersion({
      collectionId,
      collectionVersion: 1,
      collectionConfig: PagesCollectionConfig,
      action: 'create',
      documentData: { title: 'Restored first version' },
      path: originalPath,
      locale: 'all',
      status: 'draft',
    })
    const documentId = first.document.document_id
    await testDb.commandBuilders.documents.updateDocumentPath({
      documentId,
      collectionId,
      locale: 'fr',
      path: frenchPath,
    })
    const second = await testDb.commandBuilders.documents.createDocumentVersion({
      documentId,
      collectionId,
      collectionVersion: 1,
      collectionConfig: PagesCollectionConfig,
      action: 'update',
      documentData: { title: 'Restored second version' },
      locale: 'all',
      status: 'published',
      previousVersionId: first.document.id,
    })
    await testDb.commandBuilders.documents.softDeleteDocument({ document_id: documentId })

    await expect(
      testDb.commandBuilders.documents.restoreSoftDeletedDocument({ document_id: documentId })
    ).resolves.toBe(2)

    const restoredPaths = await testDb.db
      .select({
        path: documentPaths.path,
        deletedAt: documentPaths.deleted_at,
        updatedAt: documentPaths.updated_at,
      })
      .from(documentPaths)
      .where(eq(documentPaths.document_id, documentId))
    expect(restoredPaths).toHaveLength(2)
    expect(restoredPaths.map((row) => row.path).sort()).toEqual([frenchPath, originalPath].sort())
    expect(restoredPaths.every((row) => row.deletedAt == null)).toBe(true)
    const restoredAt = restoredPaths[0]?.updatedAt
    expect(restoredPaths.every((row) => row.updatedAt.getTime() === restoredAt?.getTime())).toBe(
      true
    )

    const restoredVersions = await testDb.db
      .select({
        id: documentVersions.id,
        status: documentVersions.status,
        isDeleted: documentVersions.is_deleted,
        updatedAt: documentVersions.updated_at,
      })
      .from(documentVersions)
      .where(eq(documentVersions.document_id, documentId))
    expect(restoredVersions).toHaveLength(2)
    expect(restoredVersions.map((row) => row.status).sort()).toEqual(['draft', 'published'])
    expect(restoredVersions.every((row) => !row.isDeleted)).toBe(true)
    expect(restoredVersions.every((row) => row.updatedAt.getTime() === restoredAt?.getTime())).toBe(
      true
    )

    await testDb.commandBuilders.documents.softDeleteDocument({ document_id: documentId })
    await testDb.db
      .update(documentVersions)
      .set({ is_deleted: false })
      .where(eq(documentVersions.id, second.document.id))
    await testDb.db
      .update(documentPaths)
      .set({ deleted_at: null })
      .where(eq(documentPaths.document_id, documentId))

    await expect(
      testDb.commandBuilders.documents.restoreSoftDeletedDocument({ document_id: documentId })
    ).resolves.toBe(0)

    const legacyPaths = await testDb.db
      .select({ deletedAt: documentPaths.deleted_at })
      .from(documentPaths)
      .where(eq(documentPaths.document_id, documentId))
    expect(legacyPaths.every((row) => row.deletedAt == null)).toBe(true)
    const legacyVersions = await testDb.db
      .select({ isDeleted: documentVersions.is_deleted })
      .from(documentVersions)
      .where(eq(documentVersions.document_id, documentId))
    expect(legacyVersions.map((row) => row.isDeleted).sort()).toEqual([false, true])
  })

  it('allows an existing versionless document to receive its first version', async () => {
    const documentId = crypto.randomUUID()
    const path = `versionless-${timestamp}`
    await testDb.db.insert(documents).values({
      id: documentId,
      collection_id: collectionId,
      source_locale: 'en',
    })

    const created = await testDb.commandBuilders.documents.createDocumentVersion({
      documentId,
      collectionId,
      collectionVersion: 1,
      collectionConfig: PagesCollectionConfig,
      action: 'create',
      documentData: { title: 'Versionless bootstrap' },
      path,
      locale: 'all',
      status: 'draft',
    })

    expect(created.document.document_id).toBe(documentId)
    const found = await testDb.queryBuilders.documents.getDocumentByPath({
      collection_id: collectionId,
      path,
      reconstruct: false,
    })
    expect(found?.document_id).toBe(documentId)
  })
})
