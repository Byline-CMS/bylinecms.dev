/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Integration tests for the standalone, non-versioned system-field commands —
 * `setDocumentAvailableLocales` and `updateDocumentPath`. These back the admin
 * path / available-locales widgets' direct-write Save and must write the
 * document-grain row **without** minting a new document version or touching
 * workflow status (the whole point of decoupling them from the version
 * workflow). See docs/07-internationalization/index.md.
 *
 * The invariants asserted here:
 *   - the write surfaces on the next read (advertised set / path), AND
 *   - the current `document_version_id` is unchanged (no new version), AND
 *   - the version's `status` is unchanged (no draft reset).
 */

import type { CollectionDefinition, IDbAdapter } from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ConformanceHooks } from '../index.js'

const timestamp = Date.now()

const DirectWriteCollectionConfig: CollectionDefinition = {
  path: `direct-write-${timestamp}`,
  labels: { singular: 'DirectWriteTest', plural: 'DirectWriteTests' },
  useAsPath: 'title',
  fields: [{ name: 'title', type: 'text', localized: true }],
}

type SystemFieldsRead = {
  document_id: string
  document_version_id: string
  status: string
  path?: string
  availableLocales: string[]
} | null

/**
 * Ported from
 * `packages/db-postgres/src/modules/storage/tests/storage-system-fields-direct-write.test.ts`.
 */
export function systemFieldsDirectWriteSuite(hooks: ConformanceHooks): void {
  let adapter: IDbAdapter
  let testCollection: { id: string; name: string } = {} as any

  function readById(documentId: string) {
    return adapter.queries.documents.getDocumentById({
      collection_id: testCollection.id,
      document_id: documentId,
    }) as Promise<SystemFieldsRead>
  }

  describe('non-versioned system-field commands (direct write)', () => {
    beforeAll(async () => {
      await hooks.truncate()
      adapter = await hooks.createAdapter([DirectWriteCollectionConfig])

      const result = await adapter.commands.collections.create(
        DirectWriteCollectionConfig.path,
        DirectWriteCollectionConfig
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

    it('setDocumentAvailableLocales writes the set without a new version or status change', async () => {
      const created = await adapter.commands.documents.createDocumentVersion({
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: DirectWriteCollectionConfig,
        action: 'create',
        documentData: { title: 'Advertise direct' },
        path: 'advertise-direct',
        availableLocales: ['en'],
        locale: 'all',
        status: 'published',
      })
      const documentId = created.document.document_id

      const before = await readById(documentId)
      expect(before?.availableLocales).toEqual(['en'])

      await adapter.commands.documents.setDocumentAvailableLocales({
        documentId,
        collectionId: testCollection.id,
        availableLocales: ['en', 'fr'],
      })

      const after = await readById(documentId)
      expect(after?.availableLocales, 'set rewritten').toEqual(['en', 'fr'])
      expect(after?.document_version_id, 'no new version minted').toBe(before?.document_version_id)
      expect(after?.status, 'status not reset to draft').toBe('published')
    })

    it('setDocumentAvailableLocales clears the set with an empty array, still no new version', async () => {
      const created = await adapter.commands.documents.createDocumentVersion({
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: DirectWriteCollectionConfig,
        action: 'create',
        documentData: { title: 'Advertise clear' },
        path: 'advertise-clear',
        availableLocales: ['en', 'fr'],
        locale: 'all',
        status: 'published',
      })
      const documentId = created.document.document_id
      const before = await readById(documentId)

      await adapter.commands.documents.setDocumentAvailableLocales({
        documentId,
        collectionId: testCollection.id,
        availableLocales: [],
      })

      const after = await readById(documentId)
      expect(after?.availableLocales).toEqual([])
      expect(after?.document_version_id).toBe(before?.document_version_id)
      expect(after?.status).toBe('published')
    })

    it('updateDocumentPath writes the path without a new version or status change', async () => {
      const created = await adapter.commands.documents.createDocumentVersion({
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: DirectWriteCollectionConfig,
        action: 'create',
        documentData: { title: 'Path direct' },
        path: 'path-before',
        locale: 'all',
        status: 'published',
      })
      const documentId = created.document.document_id

      const before = await readById(documentId)
      expect(before?.path).toBe('path-before')

      await adapter.commands.documents.updateDocumentPath({
        documentId,
        collectionId: testCollection.id,
        locale: 'en',
        path: 'path-after',
      })

      const after = await readById(documentId)
      expect(after?.path, 'path rewritten').toBe('path-after')
      expect(after?.document_version_id, 'no new version minted').toBe(before?.document_version_id)
      expect(after?.status, 'status not reset to draft').toBe('published')
    })

    it('updateDocumentPath raises on a colliding path (unique constraint)', async () => {
      const a = await adapter.commands.documents.createDocumentVersion({
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: DirectWriteCollectionConfig,
        action: 'create',
        documentData: { title: 'Collision A' },
        path: 'collision-taken',
        locale: 'all',
        status: 'published',
      })
      const b = await adapter.commands.documents.createDocumentVersion({
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: DirectWriteCollectionConfig,
        action: 'create',
        documentData: { title: 'Collision B' },
        path: 'collision-free',
        locale: 'all',
        status: 'published',
      })
      expect(a.document.document_id).toBeTruthy()

      await expect(
        adapter.commands.documents.updateDocumentPath({
          documentId: b.document.document_id,
          collectionId: testCollection.id,
          locale: 'en',
          // Same (collection, locale) path as document A — must collide.
          path: 'collision-taken',
        })
      ).rejects.toThrow()
    })

    it('serializes locked snapshots so a concurrent writer sees the intermediate path', async () => {
      const created = await adapter.commands.documents.createDocumentVersion({
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: DirectWriteCollectionConfig,
        action: 'create',
        documentData: { title: 'Concurrent path' },
        path: 'concurrent-before',
        availableLocales: ['en'],
        locale: 'all',
        status: 'published',
      })
      const documentId = created.document.document_id
      let releaseFirst: (() => void) | undefined
      let firstLocked: (() => void) | undefined
      const holdFirst = new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      const firstHasLock = new Promise<void>((resolve) => {
        firstLocked = resolve
      })

      let firstSnapshot:
        | Awaited<ReturnType<typeof adapter.queries.documents.getDocumentSystemFieldsForUpdate>>
        | undefined
      let secondSnapshot:
        | Awaited<ReturnType<typeof adapter.queries.documents.getDocumentSystemFieldsForUpdate>>
        | undefined
      let secondAcquired = false
      const first = adapter.withTransaction(async () => {
        firstSnapshot = await adapter.queries.documents.getDocumentSystemFieldsForUpdate({
          collection_id: testCollection.id,
          document_id: documentId,
        })
        firstLocked?.()
        await holdFirst
        await adapter.commands.documents.updateDocumentPath({
          documentId,
          collectionId: testCollection.id,
          locale: 'en',
          path: 'concurrent-middle',
        })
      })

      await firstHasLock
      const second = adapter.withTransaction(async () => {
        secondSnapshot = await adapter.queries.documents.getDocumentSystemFieldsForUpdate({
          collection_id: testCollection.id,
          document_id: documentId,
        })
        secondAcquired = true
      })
      await new Promise((resolve) => setTimeout(resolve, 25))
      const secondWasBlocked = !secondAcquired
      releaseFirst?.()
      await Promise.all([first, second])

      expect(secondWasBlocked, 'second transaction waits for the logical-document lock').toBe(true)
      expect(firstSnapshot?.path).toBe('concurrent-before')
      expect(firstSnapshot?.availableLocales).toEqual(['en'])
      expect(secondSnapshot?.path).toBe('concurrent-middle')
    })
  })
}
