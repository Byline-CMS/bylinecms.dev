/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Live-database verification of two `DocumentQueries` read paths that the
 * `@byline/db-conformance` `versioning`/`field-types` suites (Task 10A's
 * gate) can't distinguish from an easier, coincidentally-correct case:
 *
 *   - `getDocumentById`'s locale priority chain — `pathProjection`'s
 *     conversion of pg's `ANY(ARRAY[...])` + `array_position(...)` to
 *     MySQL's `IN (...)` + `ORDER BY FIELD(...)`. The gating suites never
 *     give a document more than one `byline_document_paths` row, so they
 *     can't tell "picks the only matching row" from "picks the
 *     *highest-priority* matching row when several match."
 *   - `findDocuments`' `buildDocumentOrderClause` and pagination — ported
 *     as part of Task 10A's `findDocuments` (see that method's docblock),
 *     but exercised by neither gating suite (both call `findDocuments` with
 *     only `collection_id`/`locale`/`fields`, no `orderBy`/`page`/
 *     `pageSize`). The `order_key` `ASC` branch in particular emulates
 *     Postgres's explicit `NULLS LAST` (see pg's
 *     `storage-queries.ts:2412-2416` — `NULLS LAST` on *both* directions)
 *     against MySQL's native default, which is the *opposite* of Postgres's
 *     per direction: MySQL's own `DESC` already sorts NULL last (no
 *     emulation needed, confirmed live), but MySQL's own `ASC` sorts NULL
 *     *first* (the emulation idiom `(col IS NULL) ASC, col ASC` is
 *     required). Untested dialect-emulation logic is exactly the kind of
 *     thing that silently diverges, so this file pins both directions
 *     against real NULL/non-NULL rows.
 */

import type { CollectionDefinition } from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'

const timestamp = Date.now()

function first<T>(rows: T[]): T {
  const row = rows[0]
  if (row == null) throw new Error('expected at least one row, got none')
  return row
}

/**
 * DATETIME(3) is millisecond-precision, and back-to-back inserts in a tight
 * loop can otherwise land in the same millisecond, making a `created_at`-
 * ordered (or `created_at`-tiebreaking) assertion flaky. A short delay
 * between creates keeps `created_at` strictly increasing and the expected
 * order deterministic.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const PagesCollectionConfig: CollectionDefinition = {
  path: `queries-test-pages-${timestamp}`,
  labels: { singular: 'Page', plural: 'Pages' },
  fields: [{ name: 'title', type: 'text' }],
}

const OrderKeyCollectionConfig: CollectionDefinition = {
  path: `queries-test-orderkey-${timestamp}`,
  labels: { singular: 'Item', plural: 'Items' },
  fields: [{ name: 'title', type: 'text' }],
}

const OrderingPaginationCollectionConfig: CollectionDefinition = {
  path: `queries-test-ordering-${timestamp}`,
  labels: { singular: 'Item', plural: 'Items' },
  fields: [{ name: 'title', type: 'text' }],
}

describe('DocumentQueries.getDocumentById locale-chain path resolution (mysql, live database)', () => {
  let testDb: ReturnType<typeof setupTestDB>
  let collectionId: string

  beforeAll(async () => {
    // setupTestDB's defaultContentLocale is 'en' (see test-helper.ts).
    testDb = setupTestDB([PagesCollectionConfig])
    const created = first(
      await testDb.commandBuilders.collections.create(
        PagesCollectionConfig.path,
        PagesCollectionConfig
      )
    )
    collectionId = created.id
  })

  afterAll(async () => {
    // `teardownTestDB()` is called once, at the very end of this file (see
    // the last describe block below) — closing the shared pool here would
    // pull it out from under the ordering/pagination describes that follow.
    await testDb.commandBuilders.collections.delete(collectionId)
  })

  it('prioritises the requested locale over the source-locale floor when both have a path row (FIELD() ordering)', async () => {
    const enPath = `en-path-${timestamp}`
    const frPath = `fr-path-${timestamp}`

    const created = await testDb.commandBuilders.documents.createDocumentVersion({
      collectionId,
      collectionVersion: 1,
      collectionConfig: PagesCollectionConfig,
      action: 'create',
      documentData: { title: 'Locale chain doc' },
      path: enPath,
      locale: 'en',
      status: 'draft',
    })
    const documentId = created.document.document_id

    // Add a second path row in a different locale for the same document —
    // now `byline_document_paths` has two rows: source_locale ('en') and 'fr'.
    await testDb.commandBuilders.documents.updateDocumentPath({
      documentId,
      collectionId,
      locale: 'fr',
      path: frPath,
    })

    // Requesting 'fr' directly: chain = ['fr', 'en'] (requested, then the
    // floor). Both rows are candidates — FIELD() must rank 'fr' first,
    // exactly like pg's array_position ranks the requested locale first.
    const frDoc = await testDb.queryBuilders.documents.getDocumentById({
      collection_id: collectionId,
      document_id: documentId,
      locale: 'fr',
    })
    expect(frDoc?.path).toBe(frPath)

    // Requesting a third, unrelated locale ('es'): chain = ['es', 'en'].
    // Neither row is 'es', so the `WHERE locale IN (chain)` filter alone
    // (not FIELD()'s ordering) must exclude the irrelevant 'fr' row and land
    // on the source-locale floor, 'en'.
    const esDoc = await testDb.queryBuilders.documents.getDocumentById({
      collection_id: collectionId,
      document_id: documentId,
      locale: 'es',
    })
    expect(esDoc?.path).toBe(enPath)

    // Requesting 'en' directly: chain collapses to a single-element chain
    // (`buildLocaleChain` dedupes requested === floor). Sanity check that
    // this degenerate case still resolves correctly.
    const enDoc = await testDb.queryBuilders.documents.getDocumentById({
      collection_id: collectionId,
      document_id: documentId,
      locale: 'en',
    })
    expect(enDoc?.path).toBe(enPath)
  })
})

describe('findDocuments ordering and pagination (mysql, live database)', () => {
  let testDb: ReturnType<typeof setupTestDB>

  beforeAll(() => {
    // Both collections used by the nested describes below are declared
    // upfront so `DocumentQueries.getDefinitionForCollection` can resolve
    // either one's `CollectionDefinition` off this single `queryBuilders`
    // instance — see `setupTestDB`'s doc comment.
    testDb = setupTestDB([OrderKeyCollectionConfig, OrderingPaginationCollectionConfig])
  })

  afterAll(async () => {
    await teardownTestDB()
  })

  async function createDoc(
    collectionId: string,
    config: CollectionDefinition,
    title: string,
    path: string
  ): Promise<string> {
    const created = await testDb.commandBuilders.documents.createDocumentVersion({
      collectionId,
      collectionVersion: 1,
      collectionConfig: config,
      action: 'create',
      documentData: { title },
      path,
      locale: 'en',
      status: 'draft',
    })
    return created.document.document_id
  }

  describe('order_key ordering — NULLS-last emulation', () => {
    let collectionId: string
    let doc1: string
    let doc2: string
    let doc3: string
    let doc4: string

    beforeAll(async () => {
      const created = first(
        await testDb.commandBuilders.collections.create(
          OrderKeyCollectionConfig.path,
          OrderKeyCollectionConfig
        )
      )
      collectionId = created.id

      // doc1/doc2 get an order_key; doc3/doc4 stay unkeyed (NULL). Created
      // sequentially with a short delay so the NULL rows' `created_at`
      // tiebreak (newest-first) is deterministic.
      doc1 = await createDoc(
        collectionId,
        OrderKeyCollectionConfig,
        'keyed-1',
        `keyed-1-${timestamp}`
      )
      await sleep(5)
      doc2 = await createDoc(
        collectionId,
        OrderKeyCollectionConfig,
        'keyed-2',
        `keyed-2-${timestamp}`
      )
      await sleep(5)
      doc3 = await createDoc(
        collectionId,
        OrderKeyCollectionConfig,
        'unkeyed-3',
        `unkeyed-3-${timestamp}`
      )
      await sleep(5)
      doc4 = await createDoc(
        collectionId,
        OrderKeyCollectionConfig,
        'unkeyed-4',
        `unkeyed-4-${timestamp}`
      )

      await testDb.commandBuilders.documents.setOrderKey({ document_id: doc1, order_key: '1' })
      await testDb.commandBuilders.documents.setOrderKey({ document_id: doc2, order_key: '2' })
    })

    afterAll(async () => {
      await testDb.commandBuilders.collections.delete(collectionId)
    })

    it('ascending: keyed rows first in key order, unkeyed rows last (MySQL ASC sorts NULL first natively — the emulation this pins)', async () => {
      const result = await testDb.queryBuilders.documents.findDocuments({
        collection_id: collectionId,
        locale: 'en',
        orderBy: 'order_key',
        orderDirection: 'asc',
      })
      // doc1 ('1') < doc2 ('2') ascending; doc3/doc4 (NULL) sort last, tied
      // on order_key so the `created_at DESC` secondary column decides —
      // doc4 (created after doc3) comes first.
      expect(result.documents.map((d) => d.document_id)).toEqual([doc1, doc2, doc4, doc3])
    })

    it('descending: keyed rows first in reverse key order, unkeyed rows still last (MySQL DESC already sorts NULL last natively — no emulation needed)', async () => {
      const result = await testDb.queryBuilders.documents.findDocuments({
        collection_id: collectionId,
        locale: 'en',
        orderBy: 'order_key',
        orderDirection: 'desc',
      })
      // doc2 ('2') > doc1 ('1') descending; doc3/doc4 (NULL) still sort
      // last, same created_at DESC tiebreak as the ascending case.
      expect(result.documents.map((d) => d.document_id)).toEqual([doc2, doc1, doc4, doc3])
    })
  })

  describe('document-column ordering and pagination', () => {
    let collectionId: string
    let docIds: string[] = []

    beforeAll(async () => {
      const created = first(
        await testDb.commandBuilders.collections.create(
          OrderingPaginationCollectionConfig.path,
          OrderingPaginationCollectionConfig
        )
      )
      collectionId = created.id

      docIds = []
      for (let i = 0; i < 5; i++) {
        docIds.push(
          await createDoc(
            collectionId,
            OrderingPaginationCollectionConfig,
            `col-${i}`,
            `col-${i}-${timestamp}`
          )
        )
        await sleep(5)
      }
    })

    afterAll(async () => {
      await testDb.commandBuilders.collections.delete(collectionId)
    })

    it('orders ascending by created_at (the non-order_key branch of buildDocumentOrderClause)', async () => {
      const result = await testDb.queryBuilders.documents.findDocuments({
        collection_id: collectionId,
        locale: 'en',
        orderBy: 'created_at',
        orderDirection: 'asc',
        pageSize: docIds.length,
      })
      expect(result.documents.map((d) => d.document_id)).toEqual(docIds)
    })

    it('orders descending by created_at', async () => {
      const result = await testDb.queryBuilders.documents.findDocuments({
        collection_id: collectionId,
        locale: 'en',
        orderBy: 'created_at',
        orderDirection: 'desc',
        pageSize: docIds.length,
      })
      expect(result.documents.map((d) => d.document_id)).toEqual([...docIds].reverse())
    })

    it('paginates with page/pageSize, including a page beyond the last row', async () => {
      const total = docIds.length // 5

      const page1 = await testDb.queryBuilders.documents.findDocuments({
        collection_id: collectionId,
        locale: 'en',
        orderBy: 'created_at',
        orderDirection: 'asc',
        page: 1,
        pageSize: 2,
      })
      expect(page1.total).toBe(total)
      expect(page1.documents.map((d) => d.document_id)).toEqual(docIds.slice(0, 2))

      const page2 = await testDb.queryBuilders.documents.findDocuments({
        collection_id: collectionId,
        locale: 'en',
        orderBy: 'created_at',
        orderDirection: 'asc',
        page: 2,
        pageSize: 2,
      })
      expect(page2.total).toBe(total)
      expect(page2.documents.map((d) => d.document_id)).toEqual(docIds.slice(2, 4))

      const page3 = await testDb.queryBuilders.documents.findDocuments({
        collection_id: collectionId,
        locale: 'en',
        orderBy: 'created_at',
        orderDirection: 'asc',
        page: 3,
        pageSize: 2,
      })
      expect(page3.total).toBe(total)
      expect(page3.documents.map((d) => d.document_id)).toEqual(docIds.slice(4, 5))

      // A page beyond the last row: `total` still reflects the full
      // matching count (pagination doesn't change what's being counted),
      // but this page's slice is empty.
      const pageBeyond = await testDb.queryBuilders.documents.findDocuments({
        collection_id: collectionId,
        locale: 'en',
        orderBy: 'created_at',
        orderDirection: 'asc',
        page: 4,
        pageSize: 2,
      })
      expect(pageBeyond.total).toBe(total)
      expect(pageBeyond.documents).toEqual([])
    })
  })
})
