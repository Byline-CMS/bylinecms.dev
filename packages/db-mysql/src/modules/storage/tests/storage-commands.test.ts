/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Live-database verification of the Task 9A write path
 * (`storage-insert.ts` + `storage-commands.ts`'s `CollectionCommands` and
 * `DocumentCommands.createDocumentVersion`) — the `@byline/db-conformance`
 * `versioning` and `field-types` suites can't run yet (they read documents
 * back via `getDocumentHistory` / `getDocumentByVersion` / `findDocuments`,
 * which are Task 10's `storage-queries.ts`; see the report for Task 9A for
 * why that read surface is out of this task's scope). Until Task 10 lands,
 * this file is the write path's real-database regression gate: every
 * assertion below queries the live MySQL test database directly (raw SQL
 * through the pool, not the ORM's typed read path, and never a mock) so the
 * actual bytes written by `createDocumentVersion` are what's checked, not a
 * re-statement of the write code's own assumptions.
 */

import type { CollectionDefinition } from '@byline/core'
import type mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'
import { classifyError } from '../classify-error.js'

const timestamp = Date.now()

/** `noUncheckedIndexedAccess` guard: unwrap a `T[0]`, failing loudly if empty. */
function first<T>(rows: T[]): T {
  const row = rows[0]
  if (row == null) {
    throw new Error('expected at least one row, got none')
  }
  return row
}

/** Raw SQL through the live pool — bypasses the ORM read path entirely. */
async function queryRows(pool: mysql.Pool, sql: string, params: unknown[]): Promise<any[]> {
  const [rows] = await pool.query(sql, params)
  return rows as any[]
}

async function queryOne(pool: mysql.Pool, sql: string, params: unknown[]): Promise<any> {
  return first(await queryRows(pool, sql, params))
}

const CategoriesCollectionConfig: CollectionDefinition = {
  path: `cmd-test-categories-${timestamp}`,
  labels: { singular: 'Category', plural: 'Categories' },
  fields: [{ name: 'name', type: 'text' }],
}

const ArticlesCollectionConfig: CollectionDefinition = {
  path: `cmd-test-articles-${timestamp}`,
  labels: { singular: 'Article', plural: 'Articles' },
  fields: [
    { name: 'title', type: 'text', localized: true },
    { name: 'views', type: 'integer' },
    { name: 'price', type: 'decimal' },
    { name: 'featured', type: 'boolean' },
    { name: 'publishedOn', type: 'datetime' },
    { name: 'category', type: 'relation', targetCollection: 'categories', optional: true },
    { name: 'body', type: 'richText', localized: true },
    {
      name: 'links',
      type: 'array',
      fields: [{ name: 'label', type: 'text' }],
    },
  ],
}

describe('storage-commands (mysql, live database)', () => {
  let testDb: ReturnType<typeof setupTestDB>
  let rawPool: mysql.Pool
  let categoriesId: string
  let articlesId: string
  let categoryDocumentId: string

  beforeAll(async () => {
    testDb = setupTestDB([CategoriesCollectionConfig, ArticlesCollectionConfig])
    rawPool = testDb.pool

    const categories = first(
      await testDb.commandBuilders.collections.create(
        CategoriesCollectionConfig.path,
        CategoriesCollectionConfig
      )
    )
    categoriesId = categories.id

    const articles = first(
      await testDb.commandBuilders.collections.create(
        ArticlesCollectionConfig.path,
        ArticlesCollectionConfig
      )
    )
    articlesId = articles.id

    const categoryVersion = await testDb.commandBuilders.documents.createDocumentVersion({
      collectionId: categoriesId,
      collectionVersion: 1,
      collectionConfig: CategoriesCollectionConfig,
      action: 'create',
      documentData: { name: 'News' },
      path: `news-${timestamp}`,
      locale: 'all',
      status: 'draft',
    })
    categoryDocumentId = categoryVersion.document.document_id
  })

  afterAll(async () => {
    await testDb.commandBuilders.collections.delete(articlesId)
    await testDb.commandBuilders.collections.delete(categoriesId)
    await teardownTestDB()
  })

  describe('CollectionCommands', () => {
    it('create constructs the row in JS (id/path/config known up front, no RETURNING)', async () => {
      const row = first(
        await testDb.commandBuilders.collections.create(`throwaway-${timestamp}`, {
          path: `throwaway-${timestamp}`,
          labels: { singular: 'Throwaway', plural: 'Throwaways' },
          fields: [{ name: 'x', type: 'text' }],
        })
      )
      expect(row.id).toBeTruthy()
      expect(row.path).toBe(`throwaway-${timestamp}`)
      expect(row.version).toBe(1)

      const dbRow = await queryOne(
        rawPool,
        'SELECT id, path, version FROM byline_collections WHERE id = ?',
        [row.id]
      )
      expect(dbRow.id).toBe(row.id)
      expect(dbRow.path).toBe(`throwaway-${timestamp}`)

      await testDb.commandBuilders.collections.delete(row.id)
      const afterDelete = await queryRows(
        rawPool,
        'SELECT id FROM byline_collections WHERE id = ?',
        [row.id]
      )
      expect(afterDelete.length).toBe(0)
    })

    it('update re-SELECTs the merged row (MySQL has no RETURNING)', async () => {
      const row = first(
        await testDb.commandBuilders.collections.create(`updatable-${timestamp}`, {
          path: `updatable-${timestamp}`,
          labels: { singular: 'Updatable', plural: 'Updatables' },
          fields: [{ name: 'x', type: 'text' }],
        })
      )

      const updated = first(await testDb.commandBuilders.collections.update(row.id, { version: 2 }))
      expect(updated.version).toBe(2)
      expect(updated.path).toBe(`updatable-${timestamp}`) // untouched fields survive the re-SELECT

      await testDb.commandBuilders.collections.delete(row.id)
    })
  })

  describe('DocumentCommands.createDocumentVersion', () => {
    let firstVersionId: string
    let articleDocumentId: string
    const articlePath = `first-article-${timestamp}`

    it('creates a document + version and writes every store bucket correctly', async () => {
      const result = await testDb.commandBuilders.documents.createDocumentVersion({
        collectionId: articlesId,
        collectionVersion: 1,
        collectionConfig: ArticlesCollectionConfig,
        action: 'create',
        documentData: {
          title: { en: 'Hello world', es: 'Hola mundo' },
          views: 42,
          price: '19.99',
          featured: true,
          publishedOn: new Date('2024-01-15T10:30:00.123Z'),
          category: { targetDocumentId: categoryDocumentId, targetCollectionId: categoriesId },
          body: {
            en: { root: { type: 'text', text: 'english body' } },
            es: { root: { type: 'text', text: 'spanish body' } },
          },
          links: [{ label: 'one' }, { label: 'two' }],
        },
        path: articlePath,
        availableLocales: ['en', 'es'],
        locale: 'all',
        status: 'draft',
      })

      expect(result.document.document_id).toBeTruthy()
      expect(result.document.id).toBeTruthy()
      expect(result.fieldCount).toBeGreaterThan(0)
      firstVersionId = result.document.id
      articleDocumentId = result.document.document_id

      // byline_documents — source_locale anchored to the adapter's default ('en')
      const docRow = await queryOne(
        rawPool,
        'SELECT id, collection_id, source_locale FROM byline_documents WHERE id = ?',
        [articleDocumentId]
      )
      expect(docRow.source_locale).toBe('en')
      expect(docRow.collection_id).toBe(articlesId)

      // byline_document_versions
      const versionRow = await queryOne(
        rawPool,
        'SELECT id, document_id, status, event_type, is_deleted FROM byline_document_versions WHERE id = ?',
        [firstVersionId]
      )
      expect(versionRow.status).toBe('draft')
      expect(versionRow.event_type).toBe('create')
      expect(versionRow.is_deleted).toBe(0)

      // byline_store_text — localized 'title', two locale rows
      const textRows = await queryRows(
        rawPool,
        "SELECT locale, value FROM byline_store_text WHERE document_version_id = ? AND field_name = 'title' ORDER BY locale",
        [firstVersionId]
      )
      expect(textRows.map((r) => [r.locale, r.value])).toEqual([
        ['en', 'Hello world'],
        ['es', 'Hola mundo'],
      ])

      // byline_store_numeric — integer 'views' and decimal 'price'
      const viewsRow = await queryOne(
        rawPool,
        "SELECT number_type, value_integer FROM byline_store_numeric WHERE document_version_id = ? AND field_name = 'views'",
        [firstVersionId]
      )
      expect(viewsRow.number_type).toBe('integer')
      expect(viewsRow.value_integer).toBe(42)

      const priceRow = await queryOne(
        rawPool,
        "SELECT number_type, value_decimal FROM byline_store_numeric WHERE document_version_id = ? AND field_name = 'price'",
        [firstVersionId]
      )
      expect(priceRow.number_type).toBe('decimal')
      // DECIMAL stays a string end to end (pool `decimalNumbers: false`).
      expect(typeof priceRow.value_decimal).toBe('string')
      expect(priceRow.value_decimal).toBe('19.99')

      // byline_store_boolean — TINYINT(1) on the wire; the mysql2 driver
      // returns a JS number here (0/1), not a boolean — confirmed live
      // (see normalize-row.ts's docblock). This is the raw column value
      // before any `normalizeRow` canonicalisation.
      const featuredRow = await queryOne(
        rawPool,
        "SELECT value FROM byline_store_boolean WHERE document_version_id = ? AND field_name = 'featured'",
        [firstVersionId]
      )
      expect(featuredRow.value).toBe(1)

      // byline_store_datetime — DATETIME(6) round-trips as a Date with the
      // pool's `timezone: 'Z'` option (this query goes through the raw pool,
      // not drizzle's typeCast-overridden `db.execute()` — see
      // `storage-utils.ts`'s `toDate` docblock for why that distinction
      // matters), millisecond precision intact for this millisecond-only
      // source value.
      const publishedRow = await queryOne(
        rawPool,
        "SELECT value_timestamp_tz FROM byline_store_datetime WHERE document_version_id = ? AND field_name = 'publishedOn'",
        [firstVersionId]
      )
      expect(publishedRow.value_timestamp_tz).toBeInstanceOf(Date)
      expect((publishedRow.value_timestamp_tz as Date).toISOString()).toBe(
        '2024-01-15T10:30:00.123Z'
      )

      // byline_store_relation
      const relationRow = await queryOne(
        rawPool,
        "SELECT target_document_id, target_collection_id, relationship_type, cascade_delete FROM byline_store_relation WHERE document_version_id = ? AND field_name = 'category'",
        [firstVersionId]
      )
      expect(relationRow.target_document_id).toBe(categoryDocumentId)
      expect(relationRow.target_collection_id).toBe(categoriesId)
      expect(relationRow.relationship_type).toBe('reference')
      expect(relationRow.cascade_delete).toBe(0)

      // byline_store_json — richText 'body', already-parsed object on read
      // (the driver parses JSON columns itself; `normalizeRow` must not
      // double-`JSON.parse` them).
      const bodyRow = await queryOne(
        rawPool,
        "SELECT value FROM byline_store_json WHERE document_version_id = ? AND field_name = 'body' AND locale = 'en'",
        [firstVersionId]
      )
      expect(bodyRow.value).toEqual({ root: { type: 'text', text: 'english body' } })

      // byline_store_meta — the array/array-item `_id` identity rows
      const metaRows = await queryRows(
        rawPool,
        'SELECT type, path FROM byline_store_meta WHERE document_version_id = ?',
        [firstVersionId]
      )
      expect(metaRows.length).toBeGreaterThan(0)

      // byline_document_paths — upserted under the document's source_locale
      const pathRow = await queryOne(
        rawPool,
        'SELECT path, locale, collection_id FROM byline_document_paths WHERE document_id = ?',
        [articleDocumentId]
      )
      expect(pathRow.path).toBe(articlePath)
      expect(pathRow.locale).toBe('en')
      expect(pathRow.collection_id).toBe(articlesId)

      // byline_document_available_locales — the editorial advertised set
      const availableRows = await queryRows(
        rawPool,
        'SELECT locale FROM byline_document_available_locales WHERE document_id = ? ORDER BY locale',
        [articleDocumentId]
      )
      expect(availableRows.map((r) => r.locale)).toEqual(['en', 'es'])

      // byline_document_version_locales — the completeness ledger
      const localeLedgerRows = await queryRows(
        rawPool,
        'SELECT locale FROM byline_document_version_locales WHERE document_version_id = ? ORDER BY locale',
        [firstVersionId]
      )
      expect(localeLedgerRows.map((r) => r.locale)).toEqual(['en', 'es'])
    })

    it('creates a second version of the same document (multi-version, shared document_id)', async () => {
      const second = await testDb.commandBuilders.documents.createDocumentVersion({
        documentId: articleDocumentId,
        collectionId: articlesId,
        collectionVersion: 1,
        collectionConfig: ArticlesCollectionConfig,
        action: 'update',
        documentData: {
          title: { en: 'Hello world v2', es: 'Hola mundo v2' },
          views: 43,
          price: '29.99',
          featured: false,
          publishedOn: new Date('2024-02-01T00:00:00.000Z'),
          links: [],
        },
        locale: 'all',
        status: 'draft',
      })

      expect(second.document.document_id).toBe(articleDocumentId)
      expect(second.document.id).not.toBe(firstVersionId)

      const versionRows = await queryRows(
        rawPool,
        'SELECT id FROM byline_document_versions WHERE document_id = ?',
        [articleDocumentId]
      )
      expect(versionRows.length).toBe(2)

      // The first version's rows must be untouched — versioning is immutable.
      const firstStillThere = await queryOne(
        rawPool,
        "SELECT value FROM byline_store_text WHERE document_version_id = ? AND field_name = 'title' AND locale = 'en'",
        [firstVersionId]
      )
      expect(firstStillThere.value).toBe('Hello world')
    })

    it('copies non-active-locale rows forward when saving in a single locale', async () => {
      const secondVersion = await queryOne(
        rawPool,
        'SELECT id FROM byline_document_versions WHERE document_id = ? ORDER BY id DESC LIMIT 1',
        [articleDocumentId]
      )

      const third = await testDb.commandBuilders.documents.createDocumentVersion({
        documentId: articleDocumentId,
        collectionId: articlesId,
        collectionVersion: 1,
        collectionConfig: ArticlesCollectionConfig,
        action: 'update',
        documentData: {
          title: 'Bonjour le monde', // single-locale shape: 'fr' is not 'all'
          views: 43,
          price: '29.99',
          featured: false,
          publishedOn: new Date('2024-02-01T00:00:00.000Z'),
          links: [],
        },
        previousVersionId: secondVersion.id,
        locale: 'fr',
        status: 'draft',
      })

      const thirdVersionId = third.document.id

      // The freshly-written 'fr' row plus the carried-forward 'en'/'es' rows
      // from the previous version — three distinct locales, one row each.
      const titleRows = await queryRows(
        rawPool,
        "SELECT locale, value FROM byline_store_text WHERE document_version_id = ? AND field_name = 'title' ORDER BY locale",
        [thirdVersionId]
      )
      expect(titleRows.map((r) => [r.locale, r.value])).toEqual([
        ['en', 'Hello world v2'],
        ['es', 'Hola mundo v2'],
        ['fr', 'Bonjour le monde'],
      ])
    })

    it('re-saving the same document + locale updates the path row in place (no duplicate-key error)', async () => {
      const updatedPath = `${articlePath}-renamed`

      await testDb.commandBuilders.documents.createDocumentVersion({
        documentId: articleDocumentId,
        collectionId: articlesId,
        collectionVersion: 1,
        collectionConfig: ArticlesCollectionConfig,
        action: 'update',
        documentData: {
          title: { en: 'Hello world v4' },
          views: 44,
          price: '39.99',
          featured: false,
          links: [],
        },
        path: updatedPath,
        locale: 'all',
        status: 'draft',
      })

      const pathRows = await queryRows(
        rawPool,
        'SELECT path FROM byline_document_paths WHERE document_id = ?',
        [articleDocumentId]
      )
      expect(pathRows.length).toBe(1)
      expect(pathRows[0]?.path).toBe(updatedPath)
    })
  })

  describe('path conflicts surface as a real MySQL duplicate-key error that classifyError recognises', () => {
    it('classifies a live ER_DUP_ENTRY from the (collection, locale, path) unique index', async () => {
      const conflictingPath = `conflict-${timestamp}`

      await testDb.commandBuilders.documents.createDocumentVersion({
        collectionId: articlesId,
        collectionVersion: 1,
        collectionConfig: ArticlesCollectionConfig,
        action: 'create',
        documentData: { title: 'A', views: 1, price: '1.00', featured: false, links: [] },
        path: conflictingPath,
        locale: 'all',
        status: 'draft',
      })

      let caught: unknown
      try {
        await testDb.commandBuilders.documents.createDocumentVersion({
          collectionId: articlesId,
          collectionVersion: 1,
          collectionConfig: ArticlesCollectionConfig,
          action: 'create',
          documentData: { title: 'B', views: 1, price: '1.00', featured: false, links: [] },
          path: conflictingPath,
          locale: 'all',
          status: 'draft',
        })
      } catch (err) {
        caught = err
      }

      expect(caught).toBeDefined()
      expect(classifyError(caught)).toEqual({
        code: 'DB_UNIQUE_VIOLATION',
        constraint: 'idx_document_paths_collection_locale_path',
      })
    })
  })
})
