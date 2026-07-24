/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Postgres-specific residual of the `byline_document_paths` coverage.
 *
 * The behavioural half of the original `storage-document-paths.test.ts` —
 * path uniqueness, locale-fallback reads, upsert-on-self, and
 * `getCurrentPath` — ported verbatim to `@byline/db-conformance`'s
 * `document-paths` suite (`packages/db-conformance/src/suites/document-paths.ts`),
 * now run via `packages/db-postgres/tests/conformance.integration.test.ts`.
 *
 * This one test stays behind: it exercises `reAnchorDocument`, a
 * Postgres-only maintenance operation documented as off the core
 * `IDbAdapter` contract (no `@byline/core` service depends on it), so it
 * isn't something a conforming adapter is required to implement.
 */

import type { CollectionDefinition } from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'

let commandBuilders: ReturnType<typeof import('../storage-commands.js').createCommandBuilders>
let queryBuilders: ReturnType<typeof import('../storage-queries.js').createQueryBuilders>

const timestamp = Date.now()

const PathsCollectionConfig: CollectionDefinition = {
  path: `paths-reanchor-${timestamp}`,
  labels: { singular: 'PathsReanchorTest', plural: 'PathsReanchorTests' },
  fields: [{ name: 'title', type: 'text' }],
}

let testCollection: { id: string; name: string } = {} as any

describe('byline_document_paths — getCurrentPath re-anchor (Postgres)', () => {
  beforeAll(async () => {
    const testDB = setupTestDB([PathsCollectionConfig])
    commandBuilders = testDB.commandBuilders
    queryBuilders = testDB.queryBuilders

    const result = await commandBuilders.collections.create(
      PathsCollectionConfig.path,
      PathsCollectionConfig
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

  it('follows the source-locale anchor after a document is re-anchored', async () => {
    const canonicalPath = `reanchor-path-${Date.now()}`

    // Create locale-agnostic content (ledger carries the 'all' sentinel) so
    // the document is "complete" in any target and re-anchoring is eligible.
    const created = await commandBuilders.documents.createDocumentVersion({
      collectionId: testCollection.id,
      collectionVersion: 1,
      collectionConfig: PathsCollectionConfig,
      action: 'create',
      documentData: { title: 'Re-anchor me' },
      path: canonicalPath,
      locale: 'all',
      status: 'draft',
    })
    const documentId = created.document.document_id

    // Flip the document's source locale from the default ('en') to 'fr'.
    // reAnchorDocument moves the path row onto the new source locale,
    // keeping the slug. getCurrentPath passes requestedLocale: undefined, so
    // its fallback floor is COALESCE(source_locale, default) — it must now
    // resolve via the 'fr' anchor, not the global default 'en'.
    const result = await commandBuilders.documents.reAnchorDocument({
      documentId,
      targetLocale: 'fr',
    })
    expect(result.status).toBe('reanchored')

    const path = await queryBuilders.documents.getCurrentPath({
      collection_id: testCollection.id,
      document_id: documentId,
    })
    expect(path).toBe(canonicalPath)
  })
})
