/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Integration tests for `deleteDocumentLocale` — removing one content locale's
 * data by writing a new immutable version that carries forward every store row
 * except the target locale's (the `'all'` rows and all other locales are kept).
 * Exercises the storage adapter directly (not the lifecycle service) so each
 * test isolates one storage-level invariant:
 *
 *   - the deleted locale drops out of the derived availability ledger
 *     (`_availableVersionLocales`) while the other locales remain.
 *   - other locales' localized content is untouched.
 *   - non-localized (`'all'`) content is preserved.
 *   - the new version lands with the caller-supplied status (the lifecycle
 *     passes the workflow default — a fresh draft).
 *   - the operation is recoverable: the prior version still holds the locale.
 *   - an unknown document yields `null` (defensive guard).
 */

import type { CollectionDefinition } from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'

let commandBuilders: ReturnType<typeof import('../storage-commands.js').createCommandBuilders>
let queryBuilders: ReturnType<typeof import('../storage-queries.js').createQueryBuilders>

const timestamp = Date.now()

const DeleteLocaleCollectionConfig: CollectionDefinition = {
  path: `delete-locale-${timestamp}`,
  labels: { singular: 'DeleteLocaleTest', plural: 'DeleteLocaleTests' },
  fields: [
    { name: 'title', type: 'text', localized: true },
    // Non-localized → lives on `locale: 'all'` rows; must survive the delete.
    { name: 'sku', type: 'text' },
  ],
}

let testCollection: { id: string; name: string } = {} as any

type ReconstructedRead = {
  document_id: string
  document_version_id: string
  fields: Record<string, any>
  _availableVersionLocales: string[]
} | null

function readById(documentId: string, locale: string) {
  return queryBuilders.documents.getDocumentById({
    collection_id: testCollection.id,
    document_id: documentId,
    locale,
  }) as Promise<ReconstructedRead>
}

/**
 * Create a fresh document with three localized titles (en/fr/de) and one
 * shared non-localized field, returning the document id and the current
 * (latest) version id.
 */
async function seedTrilingualDoc(titlePrefix: string) {
  const v1 = await commandBuilders.documents.createDocumentVersion({
    collectionId: testCollection.id,
    collectionVersion: 1,
    collectionConfig: DeleteLocaleCollectionConfig,
    action: 'create',
    documentData: { title: `${titlePrefix} EN`, sku: 'SKU-1' },
    locale: 'en',
    status: 'published',
  })
  const documentId = v1.document.document_id

  const v2 = await commandBuilders.documents.createDocumentVersion({
    documentId,
    collectionId: testCollection.id,
    collectionVersion: 1,
    collectionConfig: DeleteLocaleCollectionConfig,
    action: 'update',
    documentData: { title: `${titlePrefix} FR`, sku: 'SKU-1' },
    locale: 'fr',
    status: 'published',
    previousVersionId: v1.document.id,
  })

  const v3 = await commandBuilders.documents.createDocumentVersion({
    documentId,
    collectionId: testCollection.id,
    collectionVersion: 1,
    collectionConfig: DeleteLocaleCollectionConfig,
    action: 'update',
    documentData: { title: `${titlePrefix} DE`, sku: 'SKU-1' },
    locale: 'de',
    status: 'published',
    previousVersionId: v2.document.id,
  })

  return { documentId, currentVersionId: v3.document.id as string }
}

describe('deleteDocumentLocale integration', () => {
  beforeAll(async () => {
    const testDB = setupTestDB([DeleteLocaleCollectionConfig])
    commandBuilders = testDB.commandBuilders
    queryBuilders = testDB.queryBuilders

    const result = await commandBuilders.collections.create(
      DeleteLocaleCollectionConfig.path,
      DeleteLocaleCollectionConfig
    )
    const collection = result[0]
    if (collection == null) {
      throw new Error('Failed to create test collection')
    }
    testCollection = { id: collection.id, name: collection.path }
  })

  afterAll(async () => {
    try {
      await commandBuilders.collections.delete(testCollection.id)
    } catch (error) {
      console.error('Failed to cleanup test collection:', error)
    }
    await teardownTestDB()
  })

  it('drops the target locale from availability, keeps the others', async () => {
    const { documentId } = await seedTrilingualDoc('Avail')

    const before = await readById(documentId, 'en')
    expect(before?._availableVersionLocales, 'all three locales present').toEqual([
      'de',
      'en',
      'fr',
    ])

    await commandBuilders.documents.deleteDocumentLocale({
      documentId,
      locale: 'fr',
      status: 'draft',
    })

    const after = await readById(documentId, 'en')
    expect(after?._availableVersionLocales, 'fr removed, de/en remain').toEqual(['de', 'en'])
  })

  it("keeps other locales' localized content and the shared non-localized field", async () => {
    const { documentId } = await seedTrilingualDoc('Content')

    await commandBuilders.documents.deleteDocumentLocale({
      documentId,
      locale: 'fr',
      status: 'draft',
    })

    const de = await readById(documentId, 'de')
    expect(de?.fields.title, 'de content untouched').toBe('Content DE')
    expect(de?.fields.sku, "non-localized 'all' field preserved").toBe('SKU-1')

    const en = await readById(documentId, 'en')
    expect(en?.fields.title, 'default-locale content untouched').toBe('Content EN')
  })

  it('lands the new version with the supplied status (a fresh draft)', async () => {
    const { documentId } = await seedTrilingualDoc('Status')

    await commandBuilders.documents.deleteDocumentLocale({
      documentId,
      locale: 'fr',
      status: 'draft',
    })

    const meta = await queryBuilders.documents.getCurrentVersionMetadata({
      collection_id: testCollection.id,
      document_id: documentId,
    })
    expect(meta?.status, 'delete-locale version is a draft').toBe('draft')
  })

  it('is recoverable — the prior version still holds the deleted locale', async () => {
    const { documentId, currentVersionId } = await seedTrilingualDoc('Recover')

    await commandBuilders.documents.deleteDocumentLocale({
      documentId,
      locale: 'fr',
      status: 'draft',
    })

    // The pre-delete version is immutable and still carries the fr content.
    const prior = (await queryBuilders.documents.getDocumentByVersion({
      document_version_id: currentVersionId,
      locale: 'fr',
    })) as { fields: Record<string, any> } | null
    expect(prior?.fields.title, 'fr content survives in the prior version').toBe('Recover FR')
  })

  it('returns null for an unknown document', async () => {
    const result = await commandBuilders.documents.deleteDocumentLocale({
      documentId: crypto.randomUUID(),
      locale: 'fr',
      status: 'draft',
    })
    expect(result).toBeNull()
  })
})
