/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Live-database verification of `DocumentCommands.updateDocumentPath` and
 * `DocumentCommands.setDocumentAvailableLocales` (Task 9B) — the standalone,
 * non-versioned system-field writes. Same style as
 * `storage-commands.test.ts`: every assertion queries the live MySQL test
 * database directly (raw SQL through the pool), never a mock, never the
 * ORM's typed read path (which doesn't exist yet — Task 10).
 */

import type { CollectionDefinition } from '@byline/core'
import type mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'
import { classifyError } from '../classify-error.js'

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

async function queryOne(pool: mysql.Pool, sql: string, params: unknown[]): Promise<any> {
  return first(await queryRows(pool, sql, params))
}

const PagesCollectionConfig: CollectionDefinition = {
  path: `paths-test-pages-${timestamp}`,
  labels: { singular: 'Page', plural: 'Pages' },
  fields: [{ name: 'title', type: 'text' }],
}

describe('DocumentCommands.updateDocumentPath / setDocumentAvailableLocales (mysql, live database)', () => {
  let testDb: ReturnType<typeof setupTestDB>
  let rawPool: mysql.Pool
  let collectionId: string

  beforeAll(async () => {
    testDb = setupTestDB([PagesCollectionConfig])
    rawPool = testDb.pool
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

  async function createDocWithoutPath(title: string): Promise<string> {
    const created = await testDb.commandBuilders.documents.createDocumentVersion({
      collectionId,
      collectionVersion: 1,
      collectionConfig: PagesCollectionConfig,
      action: 'create',
      documentData: { title },
      locale: 'all',
      status: 'draft',
    })
    return created.document.document_id
  }

  describe('updateDocumentPath', () => {
    it('inserts a fresh path row when the document has none yet', async () => {
      const documentId = await createDocWithoutPath('Fresh Path Doc')
      const path = `fresh-${timestamp}`

      await testDb.commandBuilders.documents.updateDocumentPath({
        documentId,
        collectionId,
        locale: 'en',
        path,
      })

      const rows = await queryRows(
        rawPool,
        'SELECT path, locale, collection_id FROM byline_document_paths WHERE document_id = ?',
        [documentId]
      )
      expect(rows.length).toBe(1)
      expect(rows[0]?.path).toBe(path)
      expect(rows[0]?.locale).toBe('en')
    })

    it('updates the existing path row in place — no new document version', async () => {
      const documentId = await createDocWithoutPath('Updatable Path Doc')
      await testDb.commandBuilders.documents.updateDocumentPath({
        documentId,
        collectionId,
        locale: 'en',
        path: `updatable-v1-${timestamp}`,
      })
      const versionCountBefore = (
        await queryRows(rawPool, 'SELECT id FROM byline_document_versions WHERE document_id = ?', [
          documentId,
        ])
      ).length

      const updatedPath = `updatable-v2-${timestamp}`
      await testDb.commandBuilders.documents.updateDocumentPath({
        documentId,
        collectionId,
        locale: 'en',
        path: updatedPath,
      })

      const rows = await queryRows(
        rawPool,
        'SELECT path FROM byline_document_paths WHERE document_id = ?',
        [documentId]
      )
      expect(rows.length).toBe(1) // still one row — updated, not duplicated
      expect(rows[0]?.path).toBe(updatedPath)

      const versionCountAfter = (
        await queryRows(rawPool, 'SELECT id FROM byline_document_versions WHERE document_id = ?', [
          documentId,
        ])
      ).length
      expect(versionCountAfter).toBe(versionCountBefore) // no version minted
    })

    it('rejects a genuine cross-document path collision, surfaced via classifyError', async () => {
      const path = `collide-${timestamp}`
      const docA = await createDocWithoutPath('Collide A')
      const docB = await createDocWithoutPath('Collide B')

      await testDb.commandBuilders.documents.updateDocumentPath({
        documentId: docA,
        collectionId,
        locale: 'en',
        path,
      })

      let caught: unknown
      try {
        await testDb.commandBuilders.documents.updateDocumentPath({
          documentId: docB,
          collectionId,
          locale: 'en',
          path,
        })
      } catch (err) {
        caught = err
      }

      expect(caught).toBeDefined()
      expect(classifyError(caught)).toEqual({
        code: 'DB_UNIQUE_VIOLATION',
        constraint: 'idx_document_paths_collection_locale_path',
      })

      // docB's insert was rejected outright — no row for it, and docA's row untouched.
      const bRows = await queryRows(
        rawPool,
        'SELECT path FROM byline_document_paths WHERE document_id = ?',
        [docB]
      )
      expect(bRows.length).toBe(0)
      const aRow = await queryOne(
        rawPool,
        'SELECT path FROM byline_document_paths WHERE document_id = ?',
        [docA]
      )
      expect(aRow.path).toBe(path)
    })

    /**
     * §C.2 (binding review finding): the path upsert had no concurrent-writer
     * coverage. `writeDocumentPath` replaces Postgres's declarative
     * `onConflictDoUpdate({ target })` with application-level control flow —
     * insert, catch, classify, and only fall through to an `UPDATE` when the
     * *own-document* unique index collided (see that method's docblock). This
     * proves the classification still discriminates correctly under a true
     * race, not just the sequential collision above: two never-before-pathed
     * documents racing to claim the exact same (collection_id, locale, path)
     * via `updateDocumentPath` — the second caller into `writeDocumentPath`
     * this task wires in. Exactly one writer must win the unique index; the
     * other must surface a `DB_UNIQUE_VIOLATION` on the *cross-document*
     * index, not a duplicate row and not a silently swallowed error.
     */
    it('races two writers onto the same (collection, locale, path): one wins, one is classified as a path conflict', async () => {
      const path = `race-${timestamp}`
      const docA = await createDocWithoutPath('Race A')
      const docB = await createDocWithoutPath('Race B')

      const results = await Promise.allSettled([
        testDb.commandBuilders.documents.updateDocumentPath({
          documentId: docA,
          collectionId,
          locale: 'en',
          path,
        }),
        testDb.commandBuilders.documents.updateDocumentPath({
          documentId: docB,
          collectionId,
          locale: 'en',
          path,
        }),
      ])

      const fulfilled = results.filter((r) => r.status === 'fulfilled')
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      expect(fulfilled.length).toBe(1)
      expect(rejected.length).toBe(1)
      expect(classifyError(rejected[0]?.reason)).toEqual({
        code: 'DB_UNIQUE_VIOLATION',
        constraint: 'idx_document_paths_collection_locale_path',
      })

      // Exactly one row claims the contested path — no duplicate, no ghost row.
      const claimants = await queryRows(
        rawPool,
        'SELECT document_id FROM byline_document_paths WHERE collection_id = ? AND locale = ? AND path = ?',
        [collectionId, 'en', path]
      )
      expect(claimants.length).toBe(1)
      expect([docA, docB]).toContain(claimants[0]?.document_id)
    })
  })

  describe('setDocumentAvailableLocales', () => {
    it('writes, replaces, and clears the advertised-locale set', async () => {
      const documentId = await createDocWithoutPath('Locales Doc')

      await testDb.commandBuilders.documents.setDocumentAvailableLocales({
        documentId,
        collectionId,
        availableLocales: ['en', 'fr'],
      })
      let rows = await queryRows(
        rawPool,
        'SELECT locale FROM byline_document_available_locales WHERE document_id = ? ORDER BY locale',
        [documentId]
      )
      expect(rows.map((r) => r.locale)).toEqual(['en', 'fr'])

      // Replace wholesale — 'es' only, 'en'/'fr' dropped.
      await testDb.commandBuilders.documents.setDocumentAvailableLocales({
        documentId,
        collectionId,
        availableLocales: ['es'],
      })
      rows = await queryRows(
        rawPool,
        'SELECT locale FROM byline_document_available_locales WHERE document_id = ? ORDER BY locale',
        [documentId]
      )
      expect(rows.map((r) => r.locale)).toEqual(['es'])

      // Empty array clears the set entirely.
      await testDb.commandBuilders.documents.setDocumentAvailableLocales({
        documentId,
        collectionId,
        availableLocales: [],
      })
      rows = await queryRows(
        rawPool,
        'SELECT locale FROM byline_document_available_locales WHERE document_id = ?',
        [documentId]
      )
      expect(rows.length).toBe(0)
    })

    it('deduplicates a caller-supplied duplicate locale (PK is document_id + locale)', async () => {
      const documentId = await createDocWithoutPath('Dedup Locales Doc')

      await testDb.commandBuilders.documents.setDocumentAvailableLocales({
        documentId,
        collectionId,
        availableLocales: ['en', 'en', 'fr'],
      })
      const rows = await queryRows(
        rawPool,
        'SELECT locale FROM byline_document_available_locales WHERE document_id = ? ORDER BY locale',
        [documentId]
      )
      expect(rows.map((r) => r.locale)).toEqual(['en', 'fr'])
    })
  })
})
