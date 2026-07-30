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

import { documentPaths, documentVersions } from '../../../database/schema/index.js'
import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'

const timestamp = Date.now()

const PagesCollectionConfig: CollectionDefinition = {
  path: `live-path-queries-${timestamp}`,
  labels: { singular: 'Page', plural: 'Pages' },
  fields: [{ name: 'title', type: 'text' }],
}

describe('live-path query resolution (MySQL)', () => {
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
})
