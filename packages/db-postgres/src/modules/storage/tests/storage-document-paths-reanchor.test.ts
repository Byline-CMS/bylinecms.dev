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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { type PgAdapter, pgAdapter } from '../../../index.js'
import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'

let adapter: PgAdapter
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
    adapter = pgAdapter({
      connectionString: process.env.BYLINE_DB_POSTGRES_CONNECTION_STRING!,
      collections: [PathsCollectionConfig],
      defaultContentLocale: 'en',
    })
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
    await adapter.pool.end()
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
  const create = async () => {
    const result = await commandBuilders.documents.createDocumentVersion({
      collectionId: testCollection.id,
      collectionVersion: 1,
      collectionConfig: PathsCollectionConfig,
      action: 'create',
      documentData: { title: 'Maintenance' },
      path: crypto.randomUUID(),
      locale: 'all',
      status: 'published',
    })
    return {
      documentId: result.document.document_id as string,
      versionId: result.document.id as string,
    }
  }
  it('guarded maintenance validates dry runs and no-ops, then advances once and archives the superseded publication', async () => {
    const doc = await create()
    const target = { documentId: doc.documentId, expectedRevision: 1, targetLocale: 'fr' }
    expect(await adapter.reAnchorDocument({ ...target, dryRun: true })).toMatchObject({
      status: 'reanchored',
      revision: 1,
    })
    const changed = await adapter.reAnchorDocument(target)
    expect(changed).toMatchObject({ status: 'reanchored', revision: 2 })
    expect(await adapter.reAnchorDocument({ ...target, expectedRevision: 2 })).toMatchObject({
      status: 'already-anchored',
      revision: 2,
    })
    expect(
      (await queryBuilders.documents.getDocumentByVersion({ document_version_id: doc.versionId }))
        ?.status
    ).toBe('archived')
    await expect(adapter.reAnchorDocument(target)).rejects.toMatchObject({
      code: 'ERR_DOCUMENT_STALE',
    })
    await expect(adapter.reAnchorDocument({ ...target, dryRun: true })).rejects.toMatchObject({
      code: 'ERR_DOCUMENT_STALE',
    })
  })
  it('rejects missing observations and externally owned transactions', async () => {
    const doc = await create(),
      missing = JSON.parse('{}')
    await expect(
      adapter.reAnchorDocument({
        documentId: doc.documentId,
        targetLocale: 'fr',
        expectedRevision: missing.expectedRevision,
      })
    ).rejects.toMatchObject({ code: 'ERR_VALIDATION' })
    await expect(
      adapter.withTransaction(() =>
        adapter.reAnchorDocument({
          documentId: doc.documentId,
          targetLocale: 'fr',
          expectedRevision: 1,
        })
      )
    ).rejects.toMatchObject({
      code: 'ERR_VALIDATION',
      details: { reason: 'external_lifecycle_transaction' },
    })
  })
  it('rolls back anchor, version, audit, schedule and publication on revision failure', async () => {
    const doc = await create()
    await adapter.commands.documents.publishSchedules.schedule({
      authorizedRevision: 1,
      documentId: doc.documentId,
      collectionId: testCollection.id,
      expectedVersionId: doc.versionId,
      publishAt: new Date(Date.now() + 3600000),
      actorId: null,
    })
    const snapshot = async () => ({
      document: await adapter.queries.documents.getDocumentById({
        document_id: doc.documentId,
        collection_id: testCollection.id,
        locale: 'all',
        reconstruct: true,
        readMode: 'any',
      }),
      revision: await adapter.queries.documents.getDocumentRevision({
        document_id: doc.documentId,
        collection_id: testCollection.id,
      }),
      audit: await adapter.queries.audit.getDocumentAuditLog({ document_id: doc.documentId }),
      schedule: await adapter.queries.documents.publishSchedules.get({
        documentId: doc.documentId,
        collectionId: testCollection.id,
      }),
    })
    const before = await snapshot()
    const failure = vi
      .spyOn(adapter.revisions, 'advance')
      .mockRejectedValueOnce(new Error('re-anchor rollback'))
    try {
      await expect(
        adapter.reAnchorDocument({
          documentId: doc.documentId,
          expectedRevision: 1,
          targetLocale: 'fr',
        })
      ).rejects.toThrow('re-anchor rollback')
      expect(await snapshot()).toEqual(before)
    } finally {
      failure.mockRestore()
    }
  })
  it('uses explicit batch observations and fails on stale targets without refreshing them', async () => {
    const first = await create(),
      second = await create()
    await adapter.reAnchorDocument({
      documentId: second.documentId,
      expectedRevision: 1,
      targetLocale: 'fr',
    })
    await expect(
      adapter.reAnchorDocuments({
        targets: [first, second].map((doc) => ({
          documentId: doc.documentId,
          expectedRevision: 1,
        })),
        targetLocale: 'fr',
      })
    ).rejects.toMatchObject({ code: 'ERR_DOCUMENT_STALE' })
    expect(
      await adapter.queries.documents.getDocumentRevision({
        document_id: first.documentId,
        collection_id: testCollection.id,
      })
    ).toBe(2)
    expect(
      await adapter.queries.documents.getDocumentRevision({
        document_id: second.documentId,
        collection_id: testCollection.id,
      })
    ).toBe(2)
  })
})
