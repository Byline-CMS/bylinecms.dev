/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Live-database verification of the Task 9B status / archive / soft-delete /
 * order-key / delete-locale command surface — `DocumentCommands.setDocumentStatus`,
 * `archivePublishedVersions`, `softDeleteDocument`, `setOrderKey`, and
 * `deleteDocumentLocale`. Same style as `storage-commands.test.ts`: every
 * assertion queries the live MySQL test database directly, never a mock.
 *
 * Where a command's effect is a state transition (status, archive,
 * soft-delete), the version stream is asserted as NOT disturbed alongside the
 * changed row — status is lifecycle metadata, not content, and mutates the
 * existing version row in place rather than minting a version.
 */

import type { CollectionDefinition } from '@byline/core'
import type mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'

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

const PostsCollectionConfig: CollectionDefinition = {
  path: `lifecycle-test-posts-${timestamp}`,
  labels: { singular: 'Post', plural: 'Posts' },
  fields: [
    { name: 'title', type: 'text', localized: true },
    {
      name: 'links',
      type: 'array',
      fields: [{ name: 'label', type: 'text' }],
    },
  ],
}

describe('DocumentCommands status/archive/soft-delete/order-key/delete-locale (mysql, live database)', () => {
  let testDb: ReturnType<typeof setupTestDB>
  let rawPool: mysql.Pool
  let collectionId: string

  beforeAll(async () => {
    testDb = setupTestDB([PostsCollectionConfig])
    rawPool = testDb.pool
    const created = first(
      await testDb.commandBuilders.collections.create(
        PostsCollectionConfig.path,
        PostsCollectionConfig
      )
    )
    collectionId = created.id
  })

  afterAll(async () => {
    await testDb.commandBuilders.collections.delete(collectionId)
    await teardownTestDB()
  })

  describe('setDocumentStatus', () => {
    it('mutates the version row in place — no new version minted', async () => {
      const created = await testDb.commandBuilders.documents.createDocumentVersion({
        collectionId,
        collectionVersion: 1,
        collectionConfig: PostsCollectionConfig,
        action: 'create',
        documentData: { title: 'Status Doc', links: [] },
        locale: 'all',
        status: 'draft',
      })
      const versionId = created.document.id
      const documentId = created.document.document_id

      await testDb.commandBuilders.documents.setDocumentStatus({
        document_version_id: versionId,
        status: 'published',
      })

      const versionRow = await queryOne(
        rawPool,
        'SELECT status FROM byline_document_versions WHERE id = ?',
        [versionId]
      )
      expect(versionRow.status).toBe('published')

      const allVersions = await queryRows(
        rawPool,
        'SELECT id FROM byline_document_versions WHERE document_id = ?',
        [documentId]
      )
      expect(allVersions.length).toBe(1) // still one version — status is metadata, not content
    })
  })

  describe('archivePublishedVersions', () => {
    it('archives every published version of a document except an excluded one', async () => {
      const v1 = await testDb.commandBuilders.documents.createDocumentVersion({
        collectionId,
        collectionVersion: 1,
        collectionConfig: PostsCollectionConfig,
        action: 'create',
        documentData: { title: 'Archive Doc v1', links: [] },
        locale: 'all',
        status: 'published',
      })
      const documentId = v1.document.document_id

      const v2 = await testDb.commandBuilders.documents.createDocumentVersion({
        documentId,
        collectionId,
        collectionVersion: 1,
        collectionConfig: PostsCollectionConfig,
        action: 'update',
        documentData: { title: 'Archive Doc v2', links: [] },
        locale: 'all',
        status: 'published',
      })

      const updated = await testDb.commandBuilders.documents.archivePublishedVersions({
        document_id: documentId,
        currentStatus: 'published',
        excludeVersionId: v2.document.id,
      })
      expect(updated).toBe(1)

      const v1Row = await queryOne(
        rawPool,
        'SELECT status FROM byline_document_versions WHERE id = ?',
        [v1.document.id]
      )
      expect(v1Row.status).toBe('archived')
      const v2Row = await queryOne(
        rawPool,
        'SELECT status FROM byline_document_versions WHERE id = ?',
        [v2.document.id]
      )
      expect(v2Row.status).toBe('published') // excluded — untouched

      const versionCount = await queryRows(
        rawPool,
        'SELECT id FROM byline_document_versions WHERE document_id = ?',
        [documentId]
      )
      expect(versionCount.length).toBe(2) // no new version minted by archiving
    })

    it('returns 0 when no version matches the target status', async () => {
      const created = await testDb.commandBuilders.documents.createDocumentVersion({
        collectionId,
        collectionVersion: 1,
        collectionConfig: PostsCollectionConfig,
        action: 'create',
        documentData: { title: 'Never Published', links: [] },
        locale: 'all',
        status: 'draft',
      })
      const updated = await testDb.commandBuilders.documents.archivePublishedVersions({
        document_id: created.document.document_id,
      })
      expect(updated).toBe(0)
    })
  })

  describe('softDeleteDocument', () => {
    it('marks every version of a document as deleted', async () => {
      const v1 = await testDb.commandBuilders.documents.createDocumentVersion({
        collectionId,
        collectionVersion: 1,
        collectionConfig: PostsCollectionConfig,
        action: 'create',
        documentData: { title: 'Delete Doc v1', links: [] },
        locale: 'all',
        status: 'draft',
      })
      const documentId = v1.document.document_id
      await testDb.commandBuilders.documents.createDocumentVersion({
        documentId,
        collectionId,
        collectionVersion: 1,
        collectionConfig: PostsCollectionConfig,
        action: 'update',
        documentData: { title: 'Delete Doc v2', links: [] },
        locale: 'all',
        status: 'draft',
      })

      const affected = await testDb.commandBuilders.documents.softDeleteDocument({
        document_id: documentId,
      })
      expect(affected).toBe(2)

      const rows = await queryRows(
        rawPool,
        'SELECT is_deleted FROM byline_document_versions WHERE document_id = ?',
        [documentId]
      )
      expect(rows.length).toBe(2) // rows preserved, only tombstoned
      expect(rows.every((r) => r.is_deleted === 1)).toBe(true)
    })

    it('returns 0 for a document with no version rows (defensive guard)', async () => {
      const affected = await testDb.commandBuilders.documents.softDeleteDocument({
        document_id: '00000000-0000-7000-8000-000000000000',
      })
      expect(affected).toBe(0)
    })
  })

  describe('setOrderKey', () => {
    it('writes order_key on byline_documents without touching the version stream', async () => {
      const created = await testDb.commandBuilders.documents.createDocumentVersion({
        collectionId,
        collectionVersion: 1,
        collectionConfig: PostsCollectionConfig,
        action: 'create',
        documentData: { title: 'Order Key Doc', links: [] },
        locale: 'all',
        status: 'draft',
      })
      const documentId = created.document.document_id

      await testDb.commandBuilders.documents.setOrderKey({
        document_id: documentId,
        order_key: 'a0',
      })

      const docRow = await queryOne(
        rawPool,
        'SELECT order_key FROM byline_documents WHERE id = ?',
        [documentId]
      )
      expect(docRow.order_key).toBe('a0')

      const versionCount = await queryRows(
        rawPool,
        'SELECT id FROM byline_document_versions WHERE document_id = ?',
        [documentId]
      )
      expect(versionCount.length).toBe(1) // no new version
    })
  })

  describe('deleteDocumentLocale', () => {
    it('writes a new version carrying forward every locale except the deleted one, plus meta identities', async () => {
      const v1 = await testDb.commandBuilders.documents.createDocumentVersion({
        collectionId,
        collectionVersion: 1,
        collectionConfig: PostsCollectionConfig,
        action: 'create',
        documentData: {
          title: { en: 'Hello', es: 'Hola', fr: 'Bonjour' },
          links: [{ label: 'one' }],
        },
        locale: 'all',
        status: 'draft',
      })
      const documentId = v1.document.document_id
      const firstVersionId = v1.document.id

      const result = await testDb.commandBuilders.documents.deleteDocumentLocale({
        documentId,
        locale: 'es',
        status: 'draft',
      })
      expect(result).not.toBeNull()
      expect(result?.previousVersionId).toBe(firstVersionId)
      const newVersionId = result?.newVersionId as string
      expect(newVersionId).not.toBe(firstVersionId)

      // A genuinely new, distinct version row.
      const versionRows = await queryRows(
        rawPool,
        'SELECT id, event_type, status, change_summary FROM byline_document_versions WHERE document_id = ? ORDER BY id',
        [documentId]
      )
      expect(versionRows.length).toBe(2)
      const newVersionRow = versionRows.find((r) => r.id === newVersionId)
      expect(newVersionRow.event_type).toBe('delete_locale')
      expect(newVersionRow.status).toBe('draft')
      expect(newVersionRow.change_summary).toBe('deleted content locale es')

      // 'en' and 'fr' carried forward; 'es' dropped.
      const titleRows = await queryRows(
        rawPool,
        "SELECT locale, value FROM byline_store_text WHERE document_version_id = ? AND field_name = 'title' ORDER BY locale",
        [newVersionId]
      )
      expect(titleRows.map((r) => [r.locale, r.value])).toEqual([
        ['en', 'Hello'],
        ['fr', 'Bonjour'],
      ])

      // The prior version is untouched (immutability) — still has all three.
      const prevTitleRows = await queryRows(
        rawPool,
        "SELECT locale FROM byline_store_text WHERE document_version_id = ? AND field_name = 'title' ORDER BY locale",
        [firstVersionId]
      )
      expect(prevTitleRows.map((r) => r.locale)).toEqual(['en', 'es', 'fr'])

      // Meta identity rows (the array item's stable _id) carried forward too.
      const newMetaRows = await queryRows(
        rawPool,
        'SELECT type, path, item_id FROM byline_store_meta WHERE document_version_id = ?',
        [newVersionId]
      )
      const prevMetaRows = await queryRows(
        rawPool,
        'SELECT type, path, item_id FROM byline_store_meta WHERE document_version_id = ?',
        [firstVersionId]
      )
      expect(newMetaRows.length).toBe(prevMetaRows.length)
      expect(newMetaRows.length).toBeGreaterThan(0)
      expect(new Set(newMetaRows.map((r) => r.item_id))).toEqual(
        new Set(prevMetaRows.map((r) => r.item_id))
      )

      // The completeness ledger no longer advertises 'es'.
      const ledgerRows = await queryRows(
        rawPool,
        'SELECT locale FROM byline_document_version_locales WHERE document_version_id = ? ORDER BY locale',
        [newVersionId]
      )
      expect(ledgerRows.map((r) => r.locale)).toEqual(['en', 'fr'])
    })

    it('returns null when the document has no current (non-deleted) version', async () => {
      const result = await testDb.commandBuilders.documents.deleteDocumentLocale({
        documentId: '00000000-0000-7000-8000-000000000000',
        locale: 'es',
      })
      expect(result).toBeNull()
    })
  })
})
