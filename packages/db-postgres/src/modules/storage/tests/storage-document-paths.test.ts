/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Integration tests for the byline_document_paths layer.
 *
 * Exercises the storage adapter directly (not the lifecycle) so each test
 * isolates one storage-level invariant:
 *
 *   - per-(collection, locale) path uniqueness — the second insert with
 *     the same `(collection_id, locale, path)` triggers Postgres SQLSTATE
 *     23505 on `idx_document_paths_collection_locale_path`.
 *   - locale fallback in reads — `getDocumentByPath` with a non-default
 *     `locale` resolves through the priority chain `[requested, default]`
 *     and finds the default-locale row when no row exists for the
 *     requested locale.
 *   - upsert-on-self — re-issuing `createDocumentVersion` with the same
 *     `path` for the same `documentId` succeeds (the conflict target is
 *     `(document_id, locale)`, so the existing row is updated in place).
 */

import type { CollectionDefinition } from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'

let commandBuilders: ReturnType<typeof import('../storage-commands.js').createCommandBuilders>
let queryBuilders: ReturnType<typeof import('../storage-queries.js').createQueryBuilders>

const timestamp = Date.now()

const PathsCollectionConfig: CollectionDefinition = {
  path: `paths-${timestamp}`,
  labels: { singular: 'PathsTest', plural: 'PathsTests' },
  fields: [{ name: 'title', type: 'text' }],
}

let testCollection: { id: string; name: string } = {} as any

describe('byline_document_paths integration', () => {
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

  it('rejects a second create with the same (collection_id, locale, path)', async () => {
    const sharedPath = `dup-${Date.now()}`

    // First create succeeds — no row yet under (collection, 'en', path).
    await commandBuilders.documents.createDocumentVersion({
      collectionId: testCollection.id,
      collectionVersion: 1,
      collectionConfig: PathsCollectionConfig,
      action: 'create',
      documentData: { title: 'First' },
      path: sharedPath,
      locale: 'all',
      status: 'draft',
    })

    // Second create — different document, same path — collides on the
    // unique index `idx_document_paths_collection_locale_path`.
    let caught: any = null
    try {
      await commandBuilders.documents.createDocumentVersion({
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: PathsCollectionConfig,
        action: 'create',
        documentData: { title: 'Second' },
        path: sharedPath,
        locale: 'all',
        status: 'draft',
      })
    } catch (err) {
      caught = err
    }

    expect(caught, 'expected unique-constraint violation on duplicate path').toBeTruthy()
    // Drizzle wraps pg errors in DrizzleQueryError with the original error
    // attached as `cause`. The lifecycle layer's rethrowPathConflict reads
    // both the wrapper and the cause to detect 23505 + the path constraint
    // name; mirror that here.
    const original = caught.cause ?? caught
    expect(original.code, `expected SQLSTATE 23505, got ${original?.code}`).toBe('23505')
    expect(
      String(original.constraint ?? ''),
      `constraint name should reference the path index, got ${original?.constraint}`
    ).toMatch(/document_paths_collection_locale_path/)
  })

  it('upserts in place when the same document re-saves the same path', async () => {
    const sharedPath = `same-doc-${Date.now()}`

    const first = await commandBuilders.documents.createDocumentVersion({
      collectionId: testCollection.id,
      collectionVersion: 1,
      collectionConfig: PathsCollectionConfig,
      action: 'create',
      documentData: { title: 'V1' },
      path: sharedPath,
      locale: 'all',
      status: 'draft',
    })
    const documentId = first.document.document_id

    // Same path on the same logical document — the conflict target is
    // (document_id, locale), so onConflictDoUpdate handles this.
    const second = await commandBuilders.documents.createDocumentVersion({
      documentId,
      collectionId: testCollection.id,
      collectionVersion: 1,
      collectionConfig: PathsCollectionConfig,
      action: 'update',
      documentData: { title: 'V2' },
      path: sharedPath,
      locale: 'all',
      status: 'draft',
      previousVersionId: first.document.id,
    })

    expect(second.document.document_id, 'same logical document').toBe(documentId)
  })

  it('updates the path row in place when a document changes its path', async () => {
    const originalPath = `original-${Date.now()}`
    const updatedPath = `updated-${Date.now()}`

    const first = await commandBuilders.documents.createDocumentVersion({
      collectionId: testCollection.id,
      collectionVersion: 1,
      collectionConfig: PathsCollectionConfig,
      action: 'create',
      documentData: { title: 'X' },
      path: originalPath,
      locale: 'all',
      status: 'draft',
    })
    const documentId = first.document.document_id

    await commandBuilders.documents.createDocumentVersion({
      documentId,
      collectionId: testCollection.id,
      collectionVersion: 1,
      collectionConfig: PathsCollectionConfig,
      action: 'update',
      documentData: { title: 'X' },
      path: updatedPath,
      locale: 'all',
      status: 'draft',
      previousVersionId: first.document.id,
    })

    // The new path resolves; the old one no longer does.
    const found = await queryBuilders.documents.getDocumentByPath({
      collection_id: testCollection.id,
      path: updatedPath,
      reconstruct: false,
    })
    expect(found, 'updated path should resolve').toBeTruthy()
    expect(found?.document_id).toBe(documentId)

    const oldNotFound = await queryBuilders.documents.getDocumentByPath({
      collection_id: testCollection.id,
      path: originalPath,
      reconstruct: false,
    })
    expect(oldNotFound, 'original path no longer resolves').toBe(null)
  })

  it('falls back to the default-locale path row when the requested locale has no row', async () => {
    const onlyDefaultPath = `default-only-${Date.now()}`

    const first = await commandBuilders.documents.createDocumentVersion({
      collectionId: testCollection.id,
      collectionVersion: 1,
      collectionConfig: PathsCollectionConfig,
      action: 'create',
      documentData: { title: 'EN-Only' },
      path: onlyDefaultPath,
      locale: 'all',
      status: 'draft',
    })
    const documentId = first.document.document_id

    // No 'fr' row exists for this document; the read still resolves via
    // the [requested, default] priority chain.
    const found = await queryBuilders.documents.getDocumentByPath({
      collection_id: testCollection.id,
      path: onlyDefaultPath,
      locale: 'fr',
      reconstruct: false,
    })

    expect(found, 'fallback chain should resolve via the en row').toBeTruthy()
    expect(found?.document_id).toBe(documentId)
    expect(found?.path).toBe(onlyDefaultPath)
  })

  it('returns null on getDocumentByPath when no row matches in any locale', async () => {
    const result = await queryBuilders.documents.getDocumentByPath({
      collection_id: testCollection.id,
      path: `does-not-exist-${Date.now()}`,
      locale: 'fr',
      reconstruct: false,
    })
    expect(result).toBe(null)
  })

  describe('getCurrentPath', () => {
    it('resolves a document’s canonical path under its default source locale', async () => {
      const canonicalPath = `current-path-${Date.now()}`

      const created = await commandBuilders.documents.createDocumentVersion({
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: PathsCollectionConfig,
        action: 'create',
        documentData: { title: 'Has Path' },
        path: canonicalPath,
        locale: 'all',
        status: 'draft',
      })
      const documentId = created.document.document_id

      const path = await queryBuilders.documents.getCurrentPath({
        collection_id: testCollection.id,
        document_id: documentId,
      })

      expect(path).toBe(canonicalPath)
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

    it('returns null when the document has no path row', async () => {
      // Create a version without a `path` — no document_paths row is written.
      const created = await commandBuilders.documents.createDocumentVersion({
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: PathsCollectionConfig,
        action: 'create',
        documentData: { title: 'No Path' },
        locale: 'all',
        status: 'draft',
      })
      const documentId = created.document.document_id

      const path = await queryBuilders.documents.getCurrentPath({
        collection_id: testCollection.id,
        document_id: documentId,
      })

      expect(path).toBe(null)
    })

    it('returns null for a non-existent document', async () => {
      const path = await queryBuilders.documents.getCurrentPath({
        collection_id: testCollection.id,
        document_id: crypto.randomUUID(),
      })
      expect(path).toBe(null)
    })
  })
})
