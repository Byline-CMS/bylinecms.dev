/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Live-database verification of `DocumentQueries.getDocumentById`'s locale
 * priority chain (Task 10A) — specifically `pathProjection`'s conversion of
 * pg's `ANY(ARRAY[...])` + `array_position(...)` locale-chain resolution to
 * MySQL's `IN (...)` + `ORDER BY FIELD(...)`.
 *
 * The `@byline/db-conformance` `versioning`/`field-types` suites this task
 * turns green never exercise a document with more than one
 * `byline_document_paths` row, so they can't distinguish "picks the only
 * matching row" from "picks the *highest-priority* matching row when
 * several match" — this file pins the latter directly, per the Task 10A
 * brief's requirement to verify (not assume) that `FIELD()`'s ordering
 * semantics match `array_position`'s.
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

const PagesCollectionConfig: CollectionDefinition = {
  path: `queries-test-pages-${timestamp}`,
  labels: { singular: 'Page', plural: 'Pages' },
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
    await testDb.commandBuilders.collections.delete(collectionId)
    await teardownTestDB()
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
