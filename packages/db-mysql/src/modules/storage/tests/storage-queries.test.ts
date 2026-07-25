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

const AuthorsCollectionConfig: CollectionDefinition = {
  path: `queries-test-authors-${timestamp}`,
  labels: { singular: 'Author', plural: 'Authors' },
  fields: [{ name: 'name', type: 'text' }],
}

const PostsCollectionConfig: CollectionDefinition = {
  path: `queries-test-posts-${timestamp}`,
  labels: { singular: 'Post', plural: 'Posts' },
  fields: [
    { name: 'title', type: 'text' },
    { name: 'views', type: 'integer', optional: true },
    {
      name: 'author',
      type: 'relation',
      targetCollection: `queries-test-authors-${timestamp}`,
      optional: true,
    },
  ],
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

  // `teardownTestDB()` is called once, at the very end of this file (see the
  // last describe block below) — not here.

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

/**
 * `findDocuments`' predicate compiler and the LATERAL field-sort join —
 * none of the eleven registered `@byline/db-conformance` suites exercise
 * the `$and`/`$or` combinators, a relation hop, `pathFilter`, `query`
 * (LIKE search), or `sort` through `findDocuments` directly (the
 * document-tree suite's `filters` only reach a plain field filter via
 * `buildTreeVisibility`; `@byline/client`'s own combinator/relation-filter
 * integration suite is pg-only — see `packages/client/tests/fixtures/
 * setup.ts`). This describe block is this port's own live-database proof
 * for that surface, mirroring the values-not-just-compiles standard the
 * rest of this file already applies to `pathProjection`/`buildDocumentOrderClause`.
 */
describe('findDocuments filters, combinators, relation hops, search, and sort (mysql, live database)', () => {
  let testDb: ReturnType<typeof setupTestDB>
  let authorsCollectionId: string
  let postsCollectionId: string
  let adaId: string
  let graceId: string
  let post1: string // by Ada, views 10, title "First post"
  let post2: string // by Grace, views 20, title "Second post"
  let post3: string // by Ada, no views (NULL), title "Ünïcödé Post" (accents, mixed case)

  beforeAll(async () => {
    testDb = setupTestDB([AuthorsCollectionConfig, PostsCollectionConfig])
    authorsCollectionId = first(
      await testDb.commandBuilders.collections.create(
        AuthorsCollectionConfig.path,
        AuthorsCollectionConfig
      )
    ).id
    postsCollectionId = first(
      await testDb.commandBuilders.collections.create(
        PostsCollectionConfig.path,
        PostsCollectionConfig
      )
    ).id

    async function createAuthor(name: string): Promise<string> {
      const created = await testDb.commandBuilders.documents.createDocumentVersion({
        collectionId: authorsCollectionId,
        collectionVersion: 1,
        collectionConfig: AuthorsCollectionConfig,
        action: 'create',
        documentData: { name },
        path: `${name.toLowerCase()}-${timestamp}`,
        locale: 'en',
        status: 'published',
      })
      return created.document.document_id
    }
    async function createPost(
      title: string,
      views: number | undefined,
      authorId: string,
      path: string
    ): Promise<string> {
      const created = await testDb.commandBuilders.documents.createDocumentVersion({
        collectionId: postsCollectionId,
        collectionVersion: 1,
        collectionConfig: PostsCollectionConfig,
        action: 'create',
        documentData: {
          title,
          ...(views !== undefined ? { views } : {}),
          author: { targetDocumentId: authorId, targetCollectionId: authorsCollectionId },
        },
        path,
        locale: 'en',
        status: 'published',
      })
      return created.document.document_id
    }

    adaId = await createAuthor('Ada')
    graceId = await createAuthor('Grace')
    post1 = await createPost('First post', 10, adaId, `first-post-${timestamp}`)
    await sleep(5)
    post2 = await createPost('Second post', 20, graceId, `second-post-${timestamp}`)
    await sleep(5)
    post3 = await createPost('Ünïcödé Post', undefined, adaId, `unicode-post-${timestamp}`)
  })

  afterAll(async () => {
    await teardownTestDB()
  })

  it('$or combinator: matches either field-filter branch', async () => {
    const result = await testDb.queryBuilders.documents.findDocuments({
      collection_id: postsCollectionId,
      locale: 'en',
      filters: [
        {
          kind: 'or',
          children: [
            {
              kind: 'field',
              fieldName: 'title',
              storeType: 'text',
              valueColumn: 'value',
              operator: '$eq',
              value: 'First post',
            },
            {
              kind: 'field',
              fieldName: 'title',
              storeType: 'text',
              valueColumn: 'value',
              operator: '$eq',
              value: 'Second post',
            },
          ],
        },
      ],
    })
    expect(new Set(result.documents.map((d) => d.document_id))).toEqual(new Set([post1, post2]))
    expect(result.total).toBe(2)
  })

  it('$and combinator wrapping a docColumn(status) filter: intersects with a field filter', async () => {
    const result = await testDb.queryBuilders.documents.findDocuments({
      collection_id: postsCollectionId,
      locale: 'en',
      filters: [
        {
          kind: 'and',
          children: [
            { kind: 'docColumn', column: 'status', operator: '$eq', value: 'published' },
            {
              kind: 'field',
              fieldName: 'title',
              storeType: 'text',
              valueColumn: 'value',
              operator: '$eq',
              value: 'First post',
            },
          ],
        },
      ],
    })
    expect(result.documents.map((d) => d.document_id)).toEqual([post1])
  })

  it('relation hop: finds posts whose author matches a nested field filter', async () => {
    const result = await testDb.queryBuilders.documents.findDocuments({
      collection_id: postsCollectionId,
      locale: 'en',
      filters: [
        {
          kind: 'relation',
          fieldName: 'author',
          targetCollectionId: authorsCollectionId,
          nested: [
            {
              kind: 'field',
              fieldName: 'name',
              storeType: 'text',
              valueColumn: 'value',
              operator: '$eq',
              value: 'Ada',
            },
          ],
        },
      ],
    })
    expect(new Set(result.documents.map((d) => d.document_id))).toEqual(new Set([post1, post3]))
  })

  it('relation hop with quantifier "none": finds posts NOT authored by Ada', async () => {
    const result = await testDb.queryBuilders.documents.findDocuments({
      collection_id: postsCollectionId,
      locale: 'en',
      filters: [
        {
          kind: 'relation',
          fieldName: 'author',
          targetCollectionId: authorsCollectionId,
          quantifier: 'none',
          nested: [
            {
              kind: 'field',
              fieldName: 'name',
              storeType: 'text',
              valueColumn: 'value',
              operator: '$eq',
              value: 'Ada',
            },
          ],
        },
      ],
    })
    expect(result.documents.map((d) => d.document_id)).toEqual([post2])
  })

  it('pathFilter: matches an exact document path', async () => {
    const result = await testDb.queryBuilders.documents.findDocuments({
      collection_id: postsCollectionId,
      locale: 'en',
      pathFilter: { operator: '$eq', value: `first-post-${timestamp}` },
    })
    expect(result.documents.map((d) => d.document_id)).toEqual([post1])
  })

  it('query (LIKE admin search): matches case- and accent-insensitively — the elected ILIKE→LIKE divergence', async () => {
    // "unicode post" (lowercase, unaccented) must still match "Ünïcödé Post"
    // — utf8mb4_0900_ai_ci (the store `value` column's collation) folds both
    // case and diacritics, a strictly wider match than pg's case-only ILIKE.
    // This is the divergence documented at `findDocuments`' query-search site
    // and `buildFilterCondition`'s `$contains` branch — pinned here against a
    // real accented row rather than just asserted in a comment.
    const result = await testDb.queryBuilders.documents.findDocuments({
      collection_id: postsCollectionId,
      locale: 'en',
      query: 'unicode post',
    })
    expect(result.documents.map((d) => d.document_id)).toEqual([post3])
  })

  it('sort: LEFT JOIN LATERAL field sort on a numeric column, NULLS-last both directions', async () => {
    // post1 views=10, post2 views=20, post3 views=NULL.
    const asc = await testDb.queryBuilders.documents.findDocuments({
      collection_id: postsCollectionId,
      locale: 'en',
      sort: {
        fieldName: 'views',
        storeType: 'numeric',
        valueColumn: 'value_integer',
        direction: 'asc',
      },
    })
    // Ascending: real values first (10, 20), NULL last — the `(col IS NULL)
    // ASC, col ASC` emulation this pins (MySQL's native ASC sorts NULL first).
    expect(asc.documents.map((d) => d.document_id)).toEqual([post1, post2, post3])

    const desc = await testDb.queryBuilders.documents.findDocuments({
      collection_id: postsCollectionId,
      locale: 'en',
      sort: {
        fieldName: 'views',
        storeType: 'numeric',
        valueColumn: 'value_integer',
        direction: 'desc',
      },
    })
    // Descending: MySQL's native DESC already sorts NULL last — no emulation
    // needed, confirmed here rather than just asserted.
    expect(desc.documents.map((d) => d.document_id)).toEqual([post2, post1, post3])
  })
})
