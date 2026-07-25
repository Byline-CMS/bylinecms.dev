/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * MySQL-specific dialect properties the shared `@byline/db-conformance`
 * suite cannot express, because they pin behaviour the Postgres adapter
 * either doesn't have (collation choices) or expresses differently (its own
 * `COLLATE "C"` / native `numeric` type). Each pin below exists because a
 * real, live-server-verified property depends on a specific schema choice
 * in `packages/db-mysql/src/database/schema/{index,common}.ts` — see each
 * test's comment for the column/config it pins and why.
 */

import { type CollectionDefinition, generateKeyBetween, generateNKeysBetween } from '@byline/core'
import type mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'

const timestamp = Date.now()

function first<T>(rows: T[]): T {
  const row = rows[0]
  if (row == null) throw new Error('expected at least one row, got none')
  return row
}

async function queryRows(pool: mysql.Pool, sql: string, params: unknown[]): Promise<any[]> {
  const [rows] = await pool.query(sql, params)
  return rows as any[]
}

describe('MySQL dialect pins (live database)', () => {
  let testDb: ReturnType<typeof setupTestDB>
  let rawPool: mysql.Pool

  beforeAll(() => {
    testDb = setupTestDB()
    rawPool = testDb.pool
  })

  afterAll(async () => {
    await teardownTestDB()
  })

  describe('order_key sort parity', () => {
    // `byline_documents.order_key` is `varcharByteSorted` (`ascii_bin`)
    // specifically so `ORDER BY order_key` in SQL agrees with plain
    // JavaScript string comparison — the fractional-index algorithm in
    // `@byline/core` (`generateKeyBetween`) is designed against byte-wise
    // ordering, and MySQL's database-default collation
    // (`utf8mb4_0900_ai_ci`) does not agree with JS on every key (e.g.
    // `'Zz'` vs `'a0'` sort oppositely under the two collations). This test
    // builds a realistic, mixed-structure key spread — not just a single
    // initial batch, but keys inserted "between" existing ones the way a
    // real drag-and-drop reorder would generate them — shuffles the insert
    // order, and asserts the database's own `ORDER BY` agrees with the JS
    // sort of the exact same key strings.
    it('DB ORDER BY order_key matches JS string sort over the generateKeyBetween alphabet', async () => {
      const testCollection: CollectionDefinition = {
        path: `order-key-pin-${timestamp}`,
        labels: { singular: 'OrderKeyThing', plural: 'OrderKeyThings' },
        fields: [{ name: 'title', type: 'text' }],
      }
      const collectionId = first(
        await testDb.commandBuilders.collections.create(testCollection.path, testCollection)
      ).id

      // An initial batch of 8 keys (generateNKeysBetween bisects
      // recursively, so this alone already mixes integer-part lengths and
      // fraction lengths — a richer structure than a flat sequential
      // batch), then interleave 7 more by generating a key strictly
      // between each already-adjacent pair, the shape a real "drop between
      // these two rows" reorder produces.
      const initial = generateNKeysBetween(null, null, 8)
      const interleaved = initial.slice(0, -1).map((key, i) => {
        const next = initial[i + 1] as string
        return generateKeyBetween(key, next)
      })
      const cleanKeys = [...initial, ...interleaved]

      // Create one document per key, in shuffled order, so insertion order
      // carries no information about sort order.
      const shuffled = [...cleanKeys]
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        const tmp = shuffled[i]
        shuffled[i] = shuffled[j] as string
        shuffled[j] = tmp as string
      }

      for (const key of shuffled) {
        const created = await testDb.commandBuilders.documents.createDocumentVersion({
          collectionId,
          collectionVersion: 1,
          collectionConfig: testCollection,
          action: 'create',
          documentData: { title: key },
          locale: 'all',
          status: 'draft',
        })
        await testDb.commandBuilders.documents.setOrderKey({
          document_id: created.document.document_id,
          order_key: key,
        })
      }

      const rows = await queryRows(
        rawPool,
        'SELECT id, order_key FROM byline_documents WHERE collection_id = ? ORDER BY order_key ASC',
        [collectionId]
      )
      const dbOrderedKeys = rows.map((r) => r.order_key)
      const jsSortedKeys = [...cleanKeys].sort()

      expect(dbOrderedKeys).toEqual(jsSortedKeys)

      await testDb.commandBuilders.collections.delete(collectionId)
    })
  })

  describe('ascii_bin id equality', () => {
    // Every id/FK column uses `uuidChar` — `CHAR(36) CHARACTER SET ascii
    // COLLATE ascii_bin` — precisely so id comparisons are byte-wise
    // (case-sensitive), the MySQL analogue of Postgres's native `uuid`
    // type (which has no notion of a case-insensitive collation at all).
    // MySQL's database-default collation (`utf8mb4_0900_ai_ci`) folds
    // case, so without `ascii_bin` a case-flipped id would wrongly compare
    // equal.
    it('a CHAR(36) id differing only in case does not match', async () => {
      const testCollection: CollectionDefinition = {
        path: `ascii-bin-pin-${timestamp}`,
        labels: { singular: 'AsciiBinThing', plural: 'AsciiBinThings' },
        fields: [{ name: 'title', type: 'text' }],
      }
      const collectionId = first(
        await testDb.commandBuilders.collections.create(testCollection.path, testCollection)
      ).id
      const created = await testDb.commandBuilders.documents.createDocumentVersion({
        collectionId,
        collectionVersion: 1,
        collectionConfig: testCollection,
        action: 'create',
        documentData: { title: 'Ascii Bin' },
        locale: 'all',
        status: 'draft',
      })
      const documentId = created.document.document_id
      expect(documentId).not.toBe(documentId.toUpperCase())

      const exactMatch = await queryRows(rawPool, 'SELECT id FROM byline_documents WHERE id = ?', [
        documentId,
      ])
      expect(exactMatch).toHaveLength(1)

      const caseFlippedMatch = await queryRows(
        rawPool,
        'SELECT id FROM byline_documents WHERE id = ?',
        [documentId.toUpperCase()]
      )
      expect(caseFlippedMatch).toHaveLength(0)

      await testDb.commandBuilders.collections.delete(collectionId)
    })
  })

  describe('DATETIME(6) UTC round-trip', () => {
    // The mysql2 pool opens with `timezone: 'Z'` (see `src/index.ts` and
    // `test-helper.ts`) so `Date` values are sent and received as UTC,
    // without local-timezone reinterpretation at the connection layer —
    // MySQL's `DATETIME` has no timezone-aware storage the way Postgres's
    // `TIMESTAMPTZ` does, so this pool option is the entire mechanism.
    // `fsp: 6` on `value_timestamp_tz` (`common.ts`'s `auditTimestamp`
    // discipline, mirrored on the store table) matches pg's `TIMESTAMPTZ(6)`
    // resolution.
    it('writes a Date and reads back the identical instant', async () => {
      const testCollection: CollectionDefinition = {
        path: `datetime-utc-pin-${timestamp}`,
        labels: { singular: 'DatetimeUtcThing', plural: 'DatetimeUtcThings' },
        fields: [
          { name: 'title', type: 'text' },
          { name: 'atTime', type: 'datetime' },
        ],
      }
      // `getDocumentById` resolves the collection definition from the set
      // `queryBuilders` was constructed with — re-run `setupTestDB` with
      // this test's collection so that lookup succeeds (mirrors the
      // "Recreate queryBuilders when collections are provided" note in
      // `test-helper.ts`).
      testDb = setupTestDB([testCollection])
      const collectionId = first(
        await testDb.commandBuilders.collections.create(testCollection.path, testCollection)
      ).id
      const expected = new Date('2026-05-04T03:02:01.456Z')
      const created = await testDb.commandBuilders.documents.createDocumentVersion({
        collectionId,
        collectionVersion: 1,
        collectionConfig: testCollection,
        action: 'create',
        documentData: { title: 'UTC round-trip', atTime: expected },
        locale: 'all',
        status: 'draft',
      })

      const doc = await testDb.queryBuilders.documents.getDocumentById({
        collection_id: collectionId,
        document_id: created.document.document_id,
        locale: 'all',
      })

      const value = doc?.fields?.atTime
      expect(value).toBeInstanceOf(Date)
      expect((value as Date).getTime()).toBe(expected.getTime())

      await testDb.commandBuilders.collections.delete(collectionId)
    })
  })

  describe('DECIMAL precision preservation', () => {
    // The pool opens with `decimalNumbers: false` (`src/index.ts`,
    // `test-helper.ts`) so `DECIMAL` columns arrive as strings rather than
    // JS `number`s — MySQL/JS float coercion would silently lose precision
    // on money/decimal values otherwise, matching pg's `numeric` handling
    // (node-postgres also returns `numeric` as a string by default).
    it('returns a decimal field value as a string, not a JS number', async () => {
      const testCollection: CollectionDefinition = {
        path: `decimal-pin-${timestamp}`,
        labels: { singular: 'DecimalThing', plural: 'DecimalThings' },
        fields: [
          { name: 'title', type: 'text' },
          { name: 'price', type: 'decimal' },
        ],
      }
      testDb = setupTestDB([testCollection])
      const collectionId = first(
        await testDb.commandBuilders.collections.create(testCollection.path, testCollection)
      ).id
      const created = await testDb.commandBuilders.documents.createDocumentVersion({
        collectionId,
        collectionVersion: 1,
        collectionConfig: testCollection,
        action: 'create',
        documentData: { title: 'Decimal', price: '19.99' },
        locale: 'all',
        status: 'draft',
      })

      const doc = await testDb.queryBuilders.documents.getDocumentById({
        collection_id: collectionId,
        document_id: created.document.document_id,
        locale: 'all',
      })

      expect(typeof doc?.fields?.price).toBe('string')
      expect(doc?.fields?.price).toBe('19.99')

      await testDb.commandBuilders.collections.delete(collectionId)
    })
  })

  describe('LIKE case- and accent-insensitivity (elected divergence)', () => {
    // The store `value` text columns keep the database's default
    // `utf8mb4_0900_ai_ci` collation deliberately — unlike `order_key` /
    // id columns, which are pinned to byte-wise collations for structural
    // reasons, the *content* columns are left case- and accent-folding on
    // purpose, so admin search (`LIKE`) matches more broadly than
    // Postgres's `ILIKE` (case-only). This is an elected, spec-level
    // divergence, not an oversight — do not "fix" it by pinning `value` to
    // a binary collation. See `findDocuments`' query-search site and
    // `packages/db-mysql/src/modules/storage/tests/storage-queries.test.ts`'s
    // "query (LIKE admin search)" test for the full end-to-end behavioural
    // pin through `findDocuments`; this is the tight, direct-SQL smoke.
    it('LIKE matches a stored value across case and accent variants', async () => {
      const rows = await queryRows(rawPool, "SELECT ('Ünïcödé' LIKE ?) as matched", ['unicode'])
      expect(Number(first(rows).matched)).toBe(1)
    })
  })
})
