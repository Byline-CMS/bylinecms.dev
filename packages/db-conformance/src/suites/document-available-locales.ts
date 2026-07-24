/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Integration tests for the byline_document_available_locales layer — the
 * editorial "advertise these locales" set (document-grain, stored). Exercises
 * the storage adapter directly (not the lifecycle) so each test isolates one
 * storage-level invariant:
 *
 *   - the supplied set surfaces on reads as `availableLocales` (sorted), on
 *     detail (`getDocumentById` / `getDocumentByPath`) and list
 *     (`findDocuments`) paths.
 *   - wholesale replace — re-saving with a different set deletes the prior
 *     rows and inserts the new ones (the set is replaced, not merged).
 *   - sticky on `undefined` — omitting the param leaves the existing set
 *     untouched across a new version (document-grain, like `path`).
 *   - explicit clear — an empty array removes all advertised locales.
 *   - dedupe — caller-supplied duplicates collapse (no (document_id, locale)
 *     PK violation).
 *
 * The editorial set is independent of `advertiseLocales` (a config-validation
 * concern) and of the document's content locale — the storage layer stores and
 * projects whatever set the param carries.
 */

import type { CollectionDefinition, IDbAdapter } from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ConformanceHooks } from '../index.js'

const timestamp = Date.now()

const AdvertiseCollectionConfig: CollectionDefinition = {
  path: `advertise-${timestamp}`,
  labels: { singular: 'AdvertiseTest', plural: 'AdvertiseTests' },
  fields: [{ name: 'title', type: 'text', localized: true }],
}

// `getDocumentById` returns a union (reconstructed | raw-flattened); only the
// reconstructed branch carries `availableLocales`. These tests always read
// reconstructed, so narrow once here.
type AdvertisedRead = { document_id: string; availableLocales: string[] } | null

/**
 * Ported from
 * `packages/db-postgres/src/modules/storage/tests/storage-document-available-locales.test.ts`.
 */
export function documentAvailableLocalesSuite(hooks: ConformanceHooks): void {
  let adapter: IDbAdapter
  let testCollection: { id: string; name: string } = {} as any

  function readById(documentId: string) {
    return adapter.queries.documents.getDocumentById({
      collection_id: testCollection.id,
      document_id: documentId,
    }) as Promise<AdvertisedRead>
  }

  describe('byline_document_available_locales integration', () => {
    beforeAll(async () => {
      await hooks.truncate()
      adapter = await hooks.createAdapter([AdvertiseCollectionConfig])

      const result = await adapter.commands.collections.create(
        AdvertiseCollectionConfig.path,
        AdvertiseCollectionConfig
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

    it('surfaces the advertised set on a detail read, sorted', async () => {
      const created = await adapter.commands.documents.createDocumentVersion({
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: AdvertiseCollectionConfig,
        action: 'create',
        documentData: { title: 'Hello' },
        availableLocales: ['fr', 'en', 'de'],
        locale: 'all',
        status: 'draft',
      })

      const doc = await readById(created.document.document_id)
      expect(doc?.availableLocales, 'sorted advertised locales').toEqual(['de', 'en', 'fr'])
    })

    it('defaults to an empty set when no advertised locales were ever written', async () => {
      const created = await adapter.commands.documents.createDocumentVersion({
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: AdvertiseCollectionConfig,
        action: 'create',
        documentData: { title: 'None' },
        locale: 'all',
        status: 'draft',
      })

      const doc = await readById(created.document.document_id)
      expect(doc?.availableLocales).toEqual([])
    })

    it('replaces the set wholesale on re-save (not merged)', async () => {
      const first = await adapter.commands.documents.createDocumentVersion({
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: AdvertiseCollectionConfig,
        action: 'create',
        documentData: { title: 'V1' },
        availableLocales: ['en', 'fr'],
        locale: 'all',
        status: 'draft',
      })
      const documentId = first.document.document_id

      await adapter.commands.documents.createDocumentVersion({
        documentId,
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: AdvertiseCollectionConfig,
        action: 'update',
        documentData: { title: 'V2' },
        availableLocales: ['de'],
        locale: 'all',
        status: 'draft',
        previousVersionId: first.document.id,
      })

      const doc = await readById(documentId)
      expect(doc?.availableLocales, 'fr/en gone, only de remains').toEqual(['de'])
    })

    it('leaves the set untouched when the param is omitted (sticky across versions)', async () => {
      const first = await adapter.commands.documents.createDocumentVersion({
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: AdvertiseCollectionConfig,
        action: 'create',
        documentData: { title: 'Sticky V1' },
        availableLocales: ['en', 'de'],
        locale: 'all',
        status: 'draft',
      })
      const documentId = first.document.document_id

      // New version, no availableLocales param — advertising must carry forward.
      await adapter.commands.documents.createDocumentVersion({
        documentId,
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: AdvertiseCollectionConfig,
        action: 'update',
        documentData: { title: 'Sticky V2' },
        locale: 'all',
        status: 'draft',
        previousVersionId: first.document.id,
      })

      const doc = await readById(documentId)
      expect(doc?.availableLocales, 'editorial intent carried forward').toEqual(['de', 'en'])
    })

    it('clears the set when given an empty array', async () => {
      const first = await adapter.commands.documents.createDocumentVersion({
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: AdvertiseCollectionConfig,
        action: 'create',
        documentData: { title: 'Clear V1' },
        availableLocales: ['en', 'fr'],
        locale: 'all',
        status: 'draft',
      })
      const documentId = first.document.document_id

      await adapter.commands.documents.createDocumentVersion({
        documentId,
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: AdvertiseCollectionConfig,
        action: 'update',
        documentData: { title: 'Clear V2' },
        availableLocales: [],
        locale: 'all',
        status: 'draft',
        previousVersionId: first.document.id,
      })

      const doc = await readById(documentId)
      expect(doc?.availableLocales, 'empty array clears advertising').toEqual([])
    })

    it('deduplicates caller-supplied duplicate locales', async () => {
      const created = await adapter.commands.documents.createDocumentVersion({
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: AdvertiseCollectionConfig,
        action: 'create',
        documentData: { title: 'Dupes' },
        availableLocales: ['en', 'en', 'fr', 'fr', 'fr'],
        locale: 'all',
        status: 'draft',
      })

      const doc = await readById(created.document.document_id)
      expect(doc?.availableLocales, 'duplicates collapse, no PK violation').toEqual(['en', 'fr'])
    })

    it('surfaces the advertised set per row on a list read', async () => {
      const a = await adapter.commands.documents.createDocumentVersion({
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: AdvertiseCollectionConfig,
        action: 'create',
        documentData: { title: 'List-A' },
        availableLocales: ['en', 'fr'],
        locale: 'all',
        status: 'draft',
      })
      const b = await adapter.commands.documents.createDocumentVersion({
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: AdvertiseCollectionConfig,
        action: 'create',
        documentData: { title: 'List-B' },
        availableLocales: ['de'],
        locale: 'all',
        status: 'draft',
      })

      const { documents } = await adapter.queries.documents.findDocuments({
        collection_id: testCollection.id,
        locale: 'all',
        pageSize: 200,
      })
      const byId = new Map(documents.map((d) => [d.document_id, d]))
      expect(byId.get(a.document.document_id)?.availableLocales).toEqual(['en', 'fr'])
      expect(byId.get(b.document.document_id)?.availableLocales).toEqual(['de'])
    })
  })
}
