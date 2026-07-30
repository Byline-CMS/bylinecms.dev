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
 *     the same `(collection_id, locale, path)` triggers a unique-constraint
 *     violation (Postgres SQLSTATE 23505 on
 *     `idx_document_paths_collection_locale_path`).
 *   - locale fallback in reads — `getDocumentByPath` with a non-default
 *     `locale` resolves through the priority chain `[requested, default]`
 *     and finds the default-locale row when no row exists for the
 *     requested locale.
 *   - upsert-on-self — re-issuing `createDocumentVersion` with the same
 *     `path` for the same `documentId` succeeds (the conflict target is
 *     `(document_id, locale)`, so the existing row is updated in place).
 */

import { createSuperAdminContext } from '@byline/auth'
import {
  type BylineLogger,
  type CollectionDefinition,
  type DocumentLifecycleContext,
  duplicateDocument,
  type IDbAdapter,
} from '@byline/core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { ConformanceHooks } from '../index.js'

const timestamp = Date.now()
let pathSequence = 0

const PathsCollectionConfig: CollectionDefinition = {
  path: `paths-${timestamp}`,
  labels: { singular: 'PathsTest', plural: 'PathsTests' },
  useAsTitle: 'title',
  useAsPath: 'title',
  fields: [{ name: 'title', type: 'text' }],
}

const logger = {
  log: vi.fn(),
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
} satisfies BylineLogger

interface SoftDeleteRestorationCommands {
  restoreSoftDeletedDocument(params: { document_id: string }): Promise<number>
}

/**
 * Ported from `packages/db-postgres/src/modules/storage/tests/storage-document-paths.test.ts`.
 */
export function documentPathsSuite(hooks: ConformanceHooks): void {
  let adapter: IDbAdapter
  let testCollection: { id: string; name: string } = {} as any

  const uniquePath = (label: string): string => `${label}-${timestamp}-${pathSequence++}`

  // Task 1 pins the missing behavior before Task 4 promotes this command to
  // the public adapter contract. Keep the temporary extension test-local.
  const restoreSoftDeletedDocument = (documentId: string): Promise<number> =>
    (
      adapter.commands.documents as unknown as IDbAdapter['commands']['documents'] &
        SoftDeleteRestorationCommands
    ).restoreSoftDeletedDocument({ document_id: documentId })

  const createDocument = async ({
    documentId,
    path,
    status = 'draft',
    title = path,
    previousVersionId,
  }: {
    documentId?: string
    path: string
    status?: string
    title?: string
    previousVersionId?: string
  }) =>
    adapter.commands.documents.createDocumentVersion({
      documentId,
      collectionId: testCollection.id,
      collectionVersion: 1,
      collectionConfig: PathsCollectionConfig,
      action: documentId == null ? 'create' : 'update',
      documentData: { title },
      path,
      locale: 'all',
      status,
      previousVersionId,
    })

  const getHistory = (documentId: string) =>
    adapter.queries.documents.getDocumentHistory({
      collection_id: testCollection.id,
      document_id: documentId,
      page_size: 100,
    })

  const lifecycleContext = (): DocumentLifecycleContext => ({
    db: adapter,
    definition: PathsCollectionConfig,
    collectionId: testCollection.id,
    collectionVersion: 1,
    collectionPath: PathsCollectionConfig.path,
    logger,
    defaultLocale: 'en',
    requestContext: createSuperAdminContext(),
  })

  describe('byline_document_paths integration', () => {
    beforeAll(async () => {
      await hooks.truncate()
      adapter = await hooks.createAdapter([PathsCollectionConfig])

      const result = await adapter.commands.collections.create(
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
        await adapter.commands.collections.delete(testCollection.id)
      } catch (error) {
        console.error('Failed to cleanup test collection:', error)
      }
    })

    it('rejects a second create with the same (collection_id, locale, path)', async () => {
      const sharedPath = `dup-${Date.now()}`

      // First create succeeds — no row yet under (collection, 'en', path).
      await adapter.commands.documents.createDocumentVersion({
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
        await adapter.commands.documents.createDocumentVersion({
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
      // Adapter-agnostic: the adapter classifies its own driver error; core maps
      // this classification to ERR_PATH_CONFLICT. (The raw Postgres 23505/anatomy
      // is pinned in db-postgres's own classify-error unit test.)
      if (adapter.classifyError == null) {
        throw new Error('expected adapter to implement classifyError for this suite')
      }
      const classification = adapter.classifyError(caught)
      expect(classification.code).toBe('DB_UNIQUE_VIOLATION')
      expect(classification.constraint ?? '').toContain('document_paths_collection_locale_path')
    })

    describe('soft-delete path liveness', () => {
      it('releases a soft-deleted document path for a new live document', async () => {
        const path = uniquePath('released')
        const deleted = await createDocument({ path, title: 'Deleted occupant' })
        const deletedDocumentId = deleted.document.document_id

        await adapter.commands.documents.softDeleteDocument({
          document_id: deletedDocumentId,
        })

        const replacement = await createDocument({ path, title: 'Live replacement' })

        expect(replacement.document.document_id).not.toBe(deletedDocumentId)
        const found = await adapter.queries.documents.getDocumentByPath({
          collection_id: testCollection.id,
          path,
          reconstruct: false,
        })
        expect(found?.document_id).toBe(replacement.document.document_id)

        const deletedHistory = await getHistory(deletedDocumentId)
        expect(deletedHistory.documents).toHaveLength(1)
        expect(deletedHistory.documents[0]).toMatchObject({
          document_id: deletedDocumentId,
          path,
        })
      })

      it('allows multiple deleted documents to retain the same path', async () => {
        const path = uniquePath('reused-tombstones')
        const deletedDocumentIds: string[] = []

        for (const title of ['First occupant', 'Second occupant', 'Third occupant']) {
          const created = await createDocument({ path, title })
          const documentId = created.document.document_id
          deletedDocumentIds.push(documentId)
          await adapter.commands.documents.softDeleteDocument({ document_id: documentId })
        }

        for (const documentId of deletedDocumentIds) {
          const history = await getHistory(documentId)
          expect(history.documents).toHaveLength(1)
          expect(history.documents[0]).toMatchObject({
            document_id: documentId,
            path,
          })
        }

        const found = await adapter.queries.documents.getDocumentByPath({
          collection_id: testCollection.id,
          path,
          reconstruct: false,
        })
        expect(found).toBe(null)
      })

      it('resolves the live occupant when deleted tombstones retain its path', async () => {
        const path = uniquePath('live-wins')
        const first = await createDocument({ path, title: 'Former occupant' })
        await adapter.commands.documents.softDeleteDocument({
          document_id: first.document.document_id,
        })

        const live = await createDocument({ path, title: 'Current occupant' })
        const found = await adapter.queries.documents.getDocumentByPath({
          collection_id: testCollection.id,
          path,
          reconstruct: false,
        })

        expect(found?.document_id).toBe(live.document.document_id)
      })

      it('duplicates onto an un-suffixed path retained only by a deleted document', async () => {
        const sourceTitle = uniquePath('duplicate-deleted')
        const candidatePath = `${sourceTitle}-copy`
        const source = await createDocument({
          path: uniquePath('duplicate-deleted-source'),
          title: sourceTitle,
        })
        const deletedOccupant = await createDocument({
          path: candidatePath,
          title: 'Deleted duplicate-path occupant',
        })
        await adapter.commands.documents.softDeleteDocument({
          document_id: deletedOccupant.document.document_id,
        })

        const duplicate = await duplicateDocument(lifecycleContext(), {
          sourceDocumentId: source.document.document_id,
        })

        expect(duplicate.pathRetried).toBe(false)
        expect(duplicate.newPath).toBe(candidatePath)
        const found = await adapter.queries.documents.getDocumentByPath({
          collection_id: testCollection.id,
          path: candidatePath,
          reconstruct: false,
        })
        expect(found?.document_id).toBe(duplicate.documentId)
      })

      it('suffixes a duplicate path retained by a live document', async () => {
        const sourceTitle = uniquePath('duplicate-live')
        const candidatePath = `${sourceTitle}-copy`
        const source = await createDocument({
          path: uniquePath('duplicate-live-source'),
          title: sourceTitle,
        })
        await createDocument({
          path: candidatePath,
          title: 'Live duplicate-path occupant',
        })

        const duplicate = await duplicateDocument(lifecycleContext(), {
          sourceDocumentId: source.document.document_id,
        })

        expect(duplicate.pathRetried).toBe(true)
        expect(duplicate.newPath).toMatch(new RegExp(`^${candidatePath}-[0-9a-f]{4}$`))
        const found = await adapter.queries.documents.getDocumentByPath({
          collection_id: testCollection.id,
          path: duplicate.newPath,
          reconstruct: false,
        })
        expect(found?.document_id).toBe(duplicate.documentId)
      })

      it('restores every tombstoned version without changing status or path', async () => {
        const path = uniquePath('restore')
        const first = await createDocument({ path, status: 'draft', title: 'Draft' })
        const documentId = first.document.document_id
        await createDocument({
          documentId,
          path,
          status: 'published',
          title: 'Published',
          previousVersionId: first.document.id,
        })
        await adapter.commands.documents.softDeleteDocument({ document_id: documentId })

        await expect(restoreSoftDeletedDocument(documentId)).resolves.toBe(2)

        const history = await getHistory(documentId)
        expect(history.documents).toHaveLength(2)
        expect(history.documents.map((version) => version.status).sort()).toEqual([
          'draft',
          'published',
        ])
        expect(history.documents.every((version) => version.path === path)).toBe(true)

        const found = await adapter.queries.documents.getDocumentByPath({
          collection_id: testCollection.id,
          path,
          reconstruct: false,
        })
        expect(found?.document_id).toBe(documentId)
      })

      it('rolls back restoration when a live document has reclaimed the path', async () => {
        const path = uniquePath('restore-conflict')
        const deleted = await createDocument({ path, title: 'Deleted occupant' })
        const deletedDocumentId = deleted.document.document_id
        await adapter.commands.documents.softDeleteDocument({
          document_id: deletedDocumentId,
        })
        const live = await createDocument({ path, title: 'Live occupant' })

        await expect(restoreSoftDeletedDocument(deletedDocumentId)).rejects.toBeTruthy()

        const deletedHistory = await getHistory(deletedDocumentId)
        expect(deletedHistory.documents).toHaveLength(1)
        const found = await adapter.queries.documents.getDocumentByPath({
          collection_id: testCollection.id,
          path,
          reconstruct: false,
        })
        expect(found?.document_id).toBe(live.document.document_id)

        await adapter.commands.documents.softDeleteDocument({
          document_id: live.document.document_id,
        })
        await expect(restoreSoftDeletedDocument(deletedDocumentId)).resolves.toBe(1)
        const restored = await adapter.queries.documents.getDocumentByPath({
          collection_id: testCollection.id,
          path,
          reconstruct: false,
        })
        expect(restored?.document_id).toBe(deletedDocumentId)
      })

      it('returns zero when restoring a missing or already-live document', async () => {
        await expect(restoreSoftDeletedDocument(crypto.randomUUID())).resolves.toBe(0)

        const live = await createDocument({ path: uniquePath('already-live') })
        await expect(restoreSoftDeletedDocument(live.document.document_id)).resolves.toBe(0)
      })

      it('rejects a new version for an existing fully deleted document', async () => {
        const path = uniquePath('deleted-version-guard')
        const first = await createDocument({ path, title: 'Original' })
        const documentId = first.document.document_id
        await adapter.commands.documents.softDeleteDocument({ document_id: documentId })

        await expect(
          createDocument({
            documentId,
            path,
            title: 'Must not become live',
            previousVersionId: first.document.id,
          })
        ).rejects.toBeTruthy()

        const history = await getHistory(documentId)
        expect(history.documents).toHaveLength(1)
        expect(history.documents[0]?.document_id).toBe(documentId)
      })

      it('serializes an existing-document write with soft delete', async () => {
        const path = uniquePath('delete-write-race')
        const first = await createDocument({ path, title: 'Original' })
        const documentId = first.document.document_id

        const [write, deletion] = await Promise.allSettled([
          createDocument({
            documentId,
            path,
            title: 'Concurrent update',
            previousVersionId: first.document.id,
          }),
          adapter.commands.documents.softDeleteDocument({ document_id: documentId }),
        ])

        expect(deletion.status).toBe('fulfilled')
        expect(['fulfilled', 'rejected']).toContain(write.status)
        const deleted = await adapter.queries.documents.getDocumentByPath({
          collection_id: testCollection.id,
          path,
          reconstruct: false,
        })
        expect(deleted).toBe(null)

        const replacement = await createDocument({ path, title: 'Replacement' })
        const found = await adapter.queries.documents.getDocumentByPath({
          collection_id: testCollection.id,
          path,
          reconstruct: false,
        })
        expect(found?.document_id).toBe(replacement.document.document_id)
      })

      it('allows exactly one winner when restore races with path reuse', async () => {
        const path = uniquePath('restore-create-race')
        const deleted = await createDocument({ path, title: 'Deleted contender' })
        const deletedDocumentId = deleted.document.document_id
        await adapter.commands.documents.softDeleteDocument({
          document_id: deletedDocumentId,
        })

        const [restoration, creation] = await Promise.allSettled([
          restoreSoftDeletedDocument(deletedDocumentId),
          createDocument({ path, title: 'New contender' }),
        ])
        const fulfilledCount = [restoration, creation].filter(
          (result) => result.status === 'fulfilled'
        ).length
        expect(fulfilledCount).toBe(1)

        const found = await adapter.queries.documents.getDocumentByPath({
          collection_id: testCollection.id,
          path,
          reconstruct: false,
        })
        if (restoration.status === 'fulfilled') {
          expect(restoration.value).toBe(1)
          expect(found?.document_id).toBe(deletedDocumentId)
        } else if (creation.status === 'fulfilled') {
          expect(found?.document_id).toBe(creation.value.document.document_id)
        }
      })

      it('rolls back soft delete and path release with an outer transaction', async () => {
        // This is intentionally green before Task 2: soft delete does not
        // mutate path rows yet. It becomes the transaction-coupling guard
        // once path liveness is written alongside version tombstones.
        const path = uniquePath('delete-rollback')
        const live = await createDocument({ path })
        const documentId = live.document.document_id

        await expect(
          adapter.withTransaction(async () => {
            await adapter.commands.documents.softDeleteDocument({ document_id: documentId })
            throw new Error('roll back soft delete')
          })
        ).rejects.toThrow('roll back soft delete')

        const history = await getHistory(documentId)
        expect(history.documents).toHaveLength(1)
        const found = await adapter.queries.documents.getDocumentByPath({
          collection_id: testCollection.id,
          path,
          reconstruct: false,
        })
        expect(found?.document_id).toBe(documentId)
      })

      it('rolls back restoration and path reclaim with an outer transaction', async () => {
        const path = uniquePath('restore-rollback')
        const deleted = await createDocument({ path })
        const documentId = deleted.document.document_id
        await adapter.commands.documents.softDeleteDocument({ document_id: documentId })

        await expect(
          adapter.withTransaction(async () => {
            await restoreSoftDeletedDocument(documentId)
            throw new Error('roll back restoration')
          })
        ).rejects.toThrow('roll back restoration')

        const history = await getHistory(documentId)
        expect(history.documents).toHaveLength(1)
        const found = await adapter.queries.documents.getDocumentByPath({
          collection_id: testCollection.id,
          path,
          reconstruct: false,
        })
        expect(found).toBe(null)

        await expect(restoreSoftDeletedDocument(documentId)).resolves.toBe(1)
        const restored = await adapter.queries.documents.getDocumentByPath({
          collection_id: testCollection.id,
          path,
          reconstruct: false,
        })
        expect(restored?.document_id).toBe(documentId)
      })
    })

    it('upserts in place when the same document re-saves the same path', async () => {
      const sharedPath = `same-doc-${Date.now()}`

      const first = await adapter.commands.documents.createDocumentVersion({
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
      const second = await adapter.commands.documents.createDocumentVersion({
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

      const first = await adapter.commands.documents.createDocumentVersion({
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

      await adapter.commands.documents.createDocumentVersion({
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
      const found = await adapter.queries.documents.getDocumentByPath({
        collection_id: testCollection.id,
        path: updatedPath,
        reconstruct: false,
      })
      expect(found, 'updated path should resolve').toBeTruthy()
      expect(found?.document_id).toBe(documentId)

      const oldNotFound = await adapter.queries.documents.getDocumentByPath({
        collection_id: testCollection.id,
        path: originalPath,
        reconstruct: false,
      })
      expect(oldNotFound, 'original path no longer resolves').toBe(null)
    })

    it('falls back to the default-locale path row when the requested locale has no row', async () => {
      const onlyDefaultPath = `default-only-${Date.now()}`

      const first = await adapter.commands.documents.createDocumentVersion({
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
      const found = await adapter.queries.documents.getDocumentByPath({
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
      const result = await adapter.queries.documents.getDocumentByPath({
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

        const created = await adapter.commands.documents.createDocumentVersion({
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

        const path = await adapter.queries.documents.getCurrentPath({
          collection_id: testCollection.id,
          document_id: documentId,
        })

        expect(path).toBe(canonicalPath)
      })

      // "follows the source-locale anchor after a document is re-anchored"
      // stays in
      // packages/db-postgres/src/modules/storage/tests/storage-document-paths.test.ts
      // — it exercises `reAnchorDocument`, a Postgres-only maintenance
      // operation documented as off the core `IDbAdapter` contract (no
      // `@byline/core` service depends on it), so it isn't something a
      // conforming adapter is required to implement.

      it('returns null when the document has no path row', async () => {
        // Create a version without a `path` — no document_paths row is written.
        const created = await adapter.commands.documents.createDocumentVersion({
          collectionId: testCollection.id,
          collectionVersion: 1,
          collectionConfig: PathsCollectionConfig,
          action: 'create',
          documentData: { title: 'No Path' },
          locale: 'all',
          status: 'draft',
        })
        const documentId = created.document.document_id

        const path = await adapter.queries.documents.getCurrentPath({
          collection_id: testCollection.id,
          document_id: documentId,
        })

        expect(path).toBe(null)
      })

      it('returns null for a non-existent document', async () => {
        const path = await adapter.queries.documents.getCurrentPath({
          collection_id: testCollection.id,
          document_id: crypto.randomUUID(),
        })
        expect(path).toBe(null)
      })
    })

    // `byline_document_paths.path` is `ascii_bin`/`utf8mb4_bin`-equivalent
    // (case- and accent-sensitive) on both adapters specifically so path
    // uniqueness is byte-exact and agrees across dialects — see
    // `varcharCaseSensitive` in `packages/db-mysql/src/database/schema/
    // common.ts` and the plain `text`/default-collation `path` column on
    // Postgres. Pins today's behaviour (`/About` and `/about` are two
    // distinct documents) so that issue #48 (normalising manual path
    // overrides through core's slugifier, which would make them the *same*
    // document on both adapters) is a deliberate, knowing change rather
    // than something that drifts in per-dialect.
    it('treats case-variant paths as distinct documents', async () => {
      const stem = `Case-Variant-${Date.now()}`
      const upperPath = `/${stem}`
      const lowerPath = `/${stem.toLowerCase()}`

      const upper = await adapter.commands.documents.createDocumentVersion({
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: PathsCollectionConfig,
        action: 'create',
        documentData: { title: 'Upper' },
        path: upperPath,
        locale: 'all',
        status: 'draft',
      })

      const lower = await adapter.commands.documents.createDocumentVersion({
        collectionId: testCollection.id,
        collectionVersion: 1,
        collectionConfig: PathsCollectionConfig,
        action: 'create',
        documentData: { title: 'Lower' },
        path: lowerPath,
        locale: 'all',
        status: 'draft',
      })

      // Two distinct logical documents — the second create did not collide
      // with the first, and did not upsert onto it.
      expect(lower.document.document_id).not.toBe(upper.document.document_id)

      const upperFound = await adapter.queries.documents.getDocumentByPath({
        collection_id: testCollection.id,
        path: upperPath,
        reconstruct: false,
      })
      const lowerFound = await adapter.queries.documents.getDocumentByPath({
        collection_id: testCollection.id,
        path: lowerPath,
        reconstruct: false,
      })

      expect(upperFound?.document_id).toBe(upper.document.document_id)
      expect(lowerFound?.document_id).toBe(lower.document.document_id)
    })
  })
}
