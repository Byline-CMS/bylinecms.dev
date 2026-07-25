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
 * Recover the instant (epoch milliseconds) a `datetime` field value
 * represents, whether the adapter returned a real `Date` (mysql, via its
 * `normalize-row.ts` coercion) or the raw driver string (postgres — the EAV
 * UNION ALL collapses `value_timestamp_tz` to a TZ-less `timestamp` for
 * cross-store-table type alignment, which node-postgres returns as text;
 * see `packages/core/src/storage/storage-row-types.ts`'s
 * `FlattenedDateTimeFieldValue` doc comment). Returns `null` when the value
 * can't be parsed as either.
 */
function toInstantMs(value: unknown): number | null {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime()
  }
  return null
}

/**
 * Recover the calendar date(s) a `date` field value could represent as
 * 'YYYY-MM-DD' strings, tolerant of every representation an adapter might
 * currently return:
 *
 *   - a raw driver string (postgres, today) — the literal stored text, no
 *     midnight or timezone interpretation involved at all.
 *   - a `Date` (mysql, today) — two candidates, the calendar date read via
 *     the process's *local* getters and via its *UTC* getters. Exactly one
 *     of these is guaranteed to reproduce the stored calendar date no
 *     matter the adapter's midnight convention or the host's timezone
 *     offset: a `Date` built at UTC midnight (mysql's `toDateOnly`)
 *     recovers correctly via UTC getters always, and via local getters
 *     whenever the host is at or east of UTC; a `Date` built at local
 *     midnight (what node-postgres's own default type parser would
 *     produce, were it in play here) recovers correctly via local getters
 *     always. Returning both candidates and asking the caller to check
 *     "is the expected date among them" is what makes the assertion below
 *     agnostic to which convention is in play — see the `date` fixture's
 *     comment and the task-13 report's §B.1 evidence table for the full
 *     story, including the one case (a Date anchored at UTC midnight, read
 *     via local getters, on a host west of UTC) where the *local* candidate
 *     alone would be wrong — which is exactly why both candidates are
 *     offered rather than just one.
 */
function calendarDateCandidates(value: unknown): string[] {
  if (typeof value === 'string') {
    const match = value.match(/^\d{4}-\d{2}-\d{2}/)
    return match ? [match[0]] : []
  }
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0')
    return [
      `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
      `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`,
    ]
  }
  return []
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

    // ------------------------------------------------------------------
    // Temporal round-trip fixtures.
    //
    // Added by task 13. Before this, the suite asserted no temporal value
    // at all (only `attachment.fileSize`) — a blind spot that let three
    // real defects through the mysql port: `date`/`datetime` silently
    // returning strings instead of `Date`s through the ordinary read
    // path, a `value_time` column generated as `TIME(0)` (truncating
    // fractional seconds against a spec saying `TIME(3)`), and an
    // unresolved UTC-vs-local divergence in `date` handling. See the
    // task-13 report for the full evidence, including the discovery
    // (while writing these fixtures) that postgres's `date` **and**
    // `datetime` fields both currently return the raw driver string
    // through this same read path — already documented, if easy to miss,
    // at `packages/core/src/storage/storage-row-types.ts`'s
    // `FlattenedDateTimeFieldValue` — so mysql and postgres disagree on
    // representation (`Date` vs. string) as well as, for `date`, on
    // midnight anchor. None of that is this suite's to resolve; see the
    // `toInstantMs` / `calendarDateCandidates` helpers above for how these
    // fixtures stay representation-agnostic instead of picking a side.
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

      const instant = toInstantMs(document?.fields.publishedOn)
      expect(instant, 'expected a Date or a parseable timestamp string').not.toBeNull()
      expect(instant).toBe(expected.getTime())
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
      // `TimeField` (`packages/core/src/@types/field-types.ts`). This is
      // the fixture whose absence let a `TIME(0)` column ship on mysql,
      // silently truncating this same fractional-second value to
      // '14:30:00'.
      expect(document?.fields.onTime).toBe('14:30:00.123')
    })

    it('round-trips a calendar date, preserved regardless of which midnight the adapter anchors to', async () => {
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

      // Deliberately NOT asserting `instanceof Date` here, and deliberately
      // not deciding which midnight a `Date` return would anchor to — both
      // are an open, project-owner-only decision (see the task-13 report's
      // §B.1 evidence table). What both adapters agree on today, and all
      // this asserts, is that the calendar date itself survives the
      // round-trip.
      const value = document?.fields.onDate
      const candidates = calendarDateCandidates(value)
      expect(
        candidates.length,
        `expected a Date or a date string, got ${typeof value}`
      ).toBeGreaterThan(0)
      expect(candidates).toContain('2026-03-10')
    })
  })
}
