/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition, IDbAdapter } from '@byline/core'
import { v7 as uuidv7 } from 'uuid'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ConformanceHooks } from '../index.js'

const timestamp = Date.now()

const FieldTypesCollectionConfig: CollectionDefinition = {
  path: `field-types-${timestamp}`,
  labels: {
    singular: 'FieldTypes',
    plural: 'FieldType',
  },
  fields: [
    { name: 'title', type: 'text', localized: true },
    { name: 'summary', type: 'text', localized: true },
    { name: 'publishedOn', type: 'datetime', optional: true },
    { name: 'views', type: 'integer', optional: true },
    { name: 'price', type: 'decimal', optional: true },
    { name: 'attachment', type: 'file', optional: true },
  ],
}

const filedId = uuidv7()

// Complex test document with many fields and arrays. `path` is a
// system attribute on `documentVersions`, supplied separately to
// `createDocumentVersion` — not part of field data.
const sampleDocument = {
  title: {
    en: 'My First Document',
    es: 'Mi Primer Documento',
    fr: 'Mon Premier Document',
  },
  summary: {
    en: 'This is a sample document for testing purposes.',
    es: 'Este es un documento de muestra para fines de prueba.',
    fr: "Il s'agit d'un document d'exemple à des fins de test.",
  },
  publishedOn: new Date('2024-01-15T10:00:00'),
  views: 100,
  price: '19.99',
  attachment: {
    fileId: filedId,
    filename: 'sample-attachment.pdf',
    originalFilename: 'sample-document.pdf',
    fileSize: 102400, // 100 KB
    mimeType: 'application/pdf',
    storageProvider: 'local',
    storagePath: 'uploads/attachments/sample-attachment.pdf',
  },
}

/**
 * Ported from `packages/db-postgres/src/modules/storage/tests/storage-field-types.test.ts`.
 */
export function fieldTypesSuite(hooks: ConformanceHooks): void {
  let adapter: IDbAdapter
  let testCollection: { id: string; name: string } = {} as any

  describe('02 Field Types', () => {
    beforeAll(async () => {
      await hooks.truncate()
      adapter = await hooks.createAdapter([FieldTypesCollectionConfig])

      const result = await adapter.commands.collections.create(
        FieldTypesCollectionConfig.path,
        FieldTypesCollectionConfig
      )

      const collection = result[0]

      if (collection == null) {
        throw new Error('Failed to create test collection')
      }

      testCollection = { id: collection.id, name: collection.path }
    })

    afterAll(async () => {
      try {
        await adapter.commands.collections.delete(testCollection.id)
      } catch (error) {
        console.error('Failed to cleanup test collection:', error)
      }
    })

    it('should create and return a field type document', async () => {
      const sourceDocument = structuredClone(sampleDocument)
      const path = `my-first-field-types-document-${Date.now()}`

      const result = await adapter.commands.documents.createDocumentVersion({
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: FieldTypesCollectionConfig,
        action: 'create',
        documentData: sourceDocument,
        path,
      })

      const document = await adapter.queries.documents.getDocumentByVersion({
        document_version_id: result.document.id,
      })

      expect(document?.fields.attachment.fileSize).toBe(102400)
    })

    it('should return only requested fields with selective field loading', async () => {
      const sourceDocument = structuredClone(sampleDocument)
      const path = `selective-loading-${Date.now()}`

      await adapter.commands.documents.createDocumentVersion({
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: FieldTypesCollectionConfig,
        action: 'create',
        documentData: sourceDocument,
        path,
      })

      // Request only title and views — should query only text + numeric stores
      const result = await adapter.queries.documents.findDocuments({
        collection_id: testCollection.id,
        locale: 'en',
        fields: ['title', 'views'],
      })

      expect(result.documents.length > 0, 'should return at least one document').toBeTruthy()

      const doc = result.documents[0]
      expect(doc.fields, 'document should have fields').toBeTruthy()
      expect(doc.fields.title, 'should include title field').toBeTruthy()
      expect(doc.fields.views, 'should include views field').toBe(100)

      // Fields not requested should be absent or empty
      expect(doc.fields.price, 'should not include unrequested decimal field').toBe(undefined)
      expect(doc.fields.attachment, 'should not include unrequested file field').toBe(undefined)
    })

    it('should return all fields when no fields parameter is provided', async () => {
      const result = await adapter.queries.documents.findDocuments({
        collection_id: testCollection.id,
        locale: 'en',
      })

      expect(result.documents.length > 0, 'should return at least one document').toBeTruthy()

      const doc = result.documents[0]
      expect(doc.fields, 'document should have fields').toBeTruthy()
      expect(doc.fields.title, 'should include title').toBeTruthy()
      expect(doc.path, 'should include the system path on the document envelope').toBeTruthy()
    })
  })
}
