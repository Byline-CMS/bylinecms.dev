/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type CollectionDefinition, type IDbAdapter, parseWhere } from '@byline/core'
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
    { name: 'onDate', type: 'date', optional: true },
    { name: 'onTime', type: 'time', optional: true },
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

    it('treats an empty document-id predicate as always false', async () => {
      const created = await adapter.commands.documents.createDocumentVersion({
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: FieldTypesCollectionConfig,
        action: 'create',
        documentData: structuredClone(sampleDocument),
        path: `empty-id-predicate-${Date.now()}`,
      })
      const documentId = created.document.document_id
      const allowed = await parseWhere({ id: { $in: [documentId] } }, FieldTypesCollectionConfig)
      const denied = await parseWhere({ id: { $in: [] } }, FieldTypesCollectionConfig)

      await expect(
        adapter.queries.documents.findDocuments({
          collection_id: testCollection.id,
          filters: allowed.filters,
        })
      ).resolves.toMatchObject({ total: 1 })
      await expect(
        adapter.queries.documents.findDocuments({
          collection_id: testCollection.id,
          filters: denied.filters,
        })
      ).resolves.toEqual({ documents: [], total: 0 })
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

    // ------------------------------------------------------------------
    // Temporal round-trip fixtures.
    //
    // Added by task 13. Before this, the suite asserted no temporal value
    // at all (only `attachment.fileSize`) — a blind spot that let three
    // real defects through the mysql port: `date`/`datetime` silently
    // returning strings instead of `Date`s through the ordinary read
    // path, a `value_time` column generated as `TIME(0)` (truncating
    // fractional seconds against a spec saying `TIME(3)`), and an
    // unresolved UTC-vs-local divergence in `date` handling. Task 13
    // found that mysql and postgres disagreed here — mysql returned a
    // `Date`, postgres a raw driver string — and wrote these fixtures
    // representation-tolerant because resolving the divergence was not
    // the implementer's call to make.
    //
    // Task 13b carries the project owner's ruling: both adapters return a
    // real `Date` for `date` and `datetime`, and `date` anchors at UTC
    // midnight on both (mysql already did; postgres's
    // `normalize-row.ts` now matches — see that file's docblock for the
    // evidence that the fix belongs there rather than in the store
    // manifest). `time` is explicitly out of scope and stays a string on
    // both adapters — see the dedicated fixture below. These fixtures now
    // pin the resolved contract instead of tolerating either answer.
    // ------------------------------------------------------------------

    it('round-trips a datetime value with its sub-second precision intact', async () => {
      const path = `datetime-precision-${Date.now()}`
      // Both adapters store microsecond-capable columns (pg `TIMESTAMPTZ(6)`,
      // mysql `DATETIME(6)`), but a JS `Date` only resolves to milliseconds —
      // that's the ceiling that's actually round-trippable through the
      // public API, so this only asserts to millisecond precision.
      const expected = new Date('2024-06-01T10:15:30.123Z')

      const result = await adapter.commands.documents.createDocumentVersion({
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: FieldTypesCollectionConfig,
        action: 'create',
        documentData: { ...structuredClone(sampleDocument), publishedOn: expected },
        path,
      })

      const document = await adapter.queries.documents.getDocumentByVersion({
        document_version_id: result.document.id,
      })

      // Ruling (task 13b): `datetime` is a real `Date` on both adapters.
      const publishedOn = document?.fields.publishedOn
      expect(publishedOn).toBeInstanceOf(Date)
      expect((publishedOn as Date).getTime()).toBe(expected.getTime())
    })

    it('round-trips a bare time value at its declared precision', async () => {
      const path = `time-precision-${Date.now()}`

      const result = await adapter.commands.documents.createDocumentVersion({
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: FieldTypesCollectionConfig,
        action: 'create',
        documentData: { ...structuredClone(sampleDocument), onTime: '14:30:00.123' },
        path,
      })

      const document = await adapter.queries.documents.getDocumentByVersion({
        document_version_id: result.document.id,
      })

      // `time` is a plain string on both adapters — never a `Date` — per
      // `TimeField` (`packages/core/src/@types/field-types.ts`). A
      // time-of-day is not an instant (no calendar date, no UTC/local
      // question applies), so the task-13b "converge on Date" ruling
      // deliberately excludes it — this is the fixture pinning that as
      // intentional, not an oversight. It's also the fixture whose
      // absence let a `TIME(0)` column ship on mysql, silently truncating
      // this same fractional-second value to '14:30:00'.
      expect(document?.fields.onTime).toBe('14:30:00.123')
    })

    it('round-trips a calendar date at UTC midnight on both adapters', async () => {
      const path = `date-precision-${Date.now()}`

      const result = await adapter.commands.documents.createDocumentVersion({
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: FieldTypesCollectionConfig,
        action: 'create',
        documentData: {
          ...structuredClone(sampleDocument),
          onDate: new Date('2026-03-10T00:00:00.000Z'),
        },
        path,
      })

      const document = await adapter.queries.documents.getDocumentByVersion({
        document_version_id: result.document.id,
      })

      // Ruling (task 13b): `date` is a real `Date` anchored at **UTC**
      // midnight on both adapters — deterministic across host timezones,
      // unlike host-local midnight, which would make the same stored row
      // render as a different calendar day depending on where the process
      // runs. Assert via the UTC getters, not local ones, so this fixture
      // itself doesn't become host-timezone-dependent.
      const value = document?.fields.onDate
      expect(value).toBeInstanceOf(Date)
      const date = value as Date
      expect(date.getUTCFullYear()).toBe(2026)
      expect(date.getUTCMonth()).toBe(2) // 0-indexed: March
      expect(date.getUTCDate()).toBe(10)
      expect(date.getUTCHours()).toBe(0)
      expect(date.getUTCMinutes()).toBe(0)
      expect(date.getUTCSeconds()).toBe(0)
    })
  })
}
