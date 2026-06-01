/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Integration tests for content-locale resolution & the `onMissingLocale`
 * read switch (`'empty'` | `'fallback'` | `'omit'`).
 *
 * Exercises the storage adapter's read path directly. The default-content-locale
 * here is `'en'` (see test-helper), so a `'de'` read falls back to `'en'` only
 * under `onMissingLocale: 'fallback'`.
 *
 *   - `'fallback'` resolves a single *effective* locale per document via the
 *     chain `[requested, default]` and restores the whole document in it (never
 *     mixing). Availability is path-coverage against the default locale: a locale
 *     is "available" only when it covers every localized field path the default
 *     has, so a partial translation falls all the way back (no mixed output).
 *   - `'empty'` (and the adapter default) restores the requested locale exactly,
 *     leaving untranslated localized fields empty (the raw admin-edit view).
 *   - `'omit'` gates the document: detail → null, list → excluded.
 *   - `locale: 'all'` keeps the per-locale map shape (admin multi-locale read).
 */

import type { CollectionDefinition } from '@byline/core'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'

let commandBuilders: ReturnType<typeof import('../storage-commands.js').createCommandBuilders>
let queryBuilders: ReturnType<typeof import('../storage-queries.js').createQueryBuilders>
let db: ReturnType<typeof setupTestDB>['db']

const timestamp = Date.now()

const LocaleCollectionConfig: CollectionDefinition = {
  path: `locale-fallback-${timestamp}`,
  labels: { singular: 'LocaleTest', plural: 'LocaleTests' },
  fields: [
    { name: 'title', type: 'text', localized: true, optional: true },
    { name: 'body', type: 'textArea', localized: true, optional: true },
    { name: 'sku', type: 'text', optional: true },
  ],
}

let testCollection: { id: string; name: string } = {} as any
let seq = 0

/** Create a logical document from a multi-locale (`'all'`) field tree. */
async function createDoc(documentData: Record<string, unknown>): Promise<string> {
  seq += 1
  const result = await commandBuilders.documents.createDocumentVersion({
    collectionId: testCollection.id,
    collectionVersion: 1,
    collectionConfig: LocaleCollectionConfig,
    action: 'create',
    documentData,
    path: `loc-${timestamp}-${seq}`,
    locale: 'all',
    status: 'published',
  })
  return result.document.document_id
}

// The reconstructed read shape — `getDocumentById` returns a union of the
// reconstructed and raw-flattened branches; `readById` never passes
// `reconstruct: false`, so narrow to the reconstructed branch (the only one
// carrying the locale metadata) here rather than at every assertion site.
type ReconstructedRead = Extract<
  NonNullable<Awaited<ReturnType<typeof queryBuilders.documents.getDocumentById>>>,
  { _localeAgnostic: boolean }
>

function readById(
  documentId: string,
  locale: string,
  onMissingLocale?: 'empty' | 'fallback' | 'omit'
) {
  return queryBuilders.documents.getDocumentById({
    collection_id: testCollection.id,
    document_id: documentId,
    locale,
    onMissingLocale,
  }) as Promise<ReconstructedRead | null>
}

describe('content-locale resolution & fallback', () => {
  beforeAll(async () => {
    const testDB = setupTestDB([LocaleCollectionConfig])
    commandBuilders = testDB.commandBuilders
    queryBuilders = testDB.queryBuilders
    db = testDB.db

    const result = await commandBuilders.collections.create(
      LocaleCollectionConfig.path,
      LocaleCollectionConfig
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

  it('renders the requested locale when fully translated', async () => {
    const id = await createDoc({
      title: { en: 'Hello', de: 'Hallo' },
      body: { en: 'World', de: 'Welt' },
      sku: 'X1',
    })

    const doc = await readById(id, 'de')
    expect(doc?.fields).toMatchObject({ title: 'Hallo', body: 'Welt', sku: 'X1' })
  })

  it("'fallback' renders the default for a partial translation — never mixes locales", async () => {
    // `de` has a title but no body. Under path-coverage `de` is unavailable,
    // so the whole document renders in `en` — NOT { title: 'Hallo', body: 'World' }.
    const id = await createDoc({
      title: { en: 'Hello', de: 'Hallo' },
      body: { en: 'World' },
      sku: 'X2',
    })

    const doc = await readById(id, 'de', 'fallback')
    expect(doc?.fields).toMatchObject({ title: 'Hello', body: 'World', sku: 'X2' })
    expect(doc?.fields.title, 'must not show the orphan German title').not.toBe('Hallo')
  })

  it("'fallback' renders the default when the locale is entirely absent", async () => {
    const id = await createDoc({
      title: { en: 'Hello' },
      body: { en: 'World' },
      sku: 'X3',
    })

    const doc = await readById(id, 'de', 'fallback')
    expect(doc?.fields).toMatchObject({ title: 'Hello', body: 'World', sku: 'X3' })
  })

  it("default/'empty' restores the requested locale exactly — empty where untranslated (admin edit view)", async () => {
    // Partial `de`: title translated, body not. The raw per-locale view shows
    // the `de` title and leaves the `de` body empty — no fallback to `en`.
    // Non-localized fields (`sku`, stored under 'all') are always present.
    const id = await createDoc({
      title: { en: 'Hello', de: 'Hallo' },
      body: { en: 'World' },
      sku: 'N1',
    })

    const omitted = await readById(id, 'de')
    expect(omitted?.fields.title, 'de title shown as-is').toBe('Hallo')
    expect(omitted?.fields.body, 'untranslated de body stays empty (no fallback)').toBeUndefined()
    expect(omitted?.fields.sku, 'non-localized field always present').toBe('N1')

    // Explicit 'empty' behaves identically to the omitted default.
    const explicit = await readById(id, 'de', 'empty')
    expect(explicit?.fields.title).toBe('Hallo')
    expect(explicit?.fields.body).toBeUndefined()
  })

  it('returns non-localized values for a document with no localized content', async () => {
    // Empty canonical set → any requested locale is trivially available.
    const id = await createDoc({ sku: 'X4' })

    const doc = await readById(id, 'de')
    expect(doc?.fields.sku).toBe('X4')
    expect(doc?.fields.title).toBeUndefined()
    expect(doc?.fields.body).toBeUndefined()
  })

  it("preserves the per-locale map shape for an admin 'all' read", async () => {
    const id = await createDoc({
      title: { en: 'Hello', de: 'Hallo' },
      body: { en: 'World', de: 'Welt' },
      sku: 'X5',
    })

    const doc = await readById(id, 'all')
    expect(doc?.fields.title).toEqual({ en: 'Hello', de: 'Hallo' })
    expect(doc?.fields.body).toEqual({ en: 'World', de: 'Welt' })
    expect(doc?.fields.sku).toBe('X5')
  })

  it("'fallback' resolves an effective locale per document across a list query", async () => {
    const translated = await createDoc({
      title: { en: 'Listed EN', de: 'Listed DE' },
      body: { en: 'B', de: 'B-de' },
      sku: 'L1',
    })
    const enOnly = await createDoc({
      title: { en: 'EN Only' },
      body: { en: 'B' },
      sku: 'L2',
    })

    const { documents } = await queryBuilders.documents.findDocuments({
      collection_id: testCollection.id,
      locale: 'de',
      onMissingLocale: 'fallback',
      pageSize: 100,
    })

    const byId = new Map(documents.map((d) => [d.document_id, d]))
    expect(byId.get(translated)?.fields.title).toBe('Listed DE')
    expect(byId.get(enOnly)?.fields.title, 'untranslated row falls back to en').toBe('EN Only')
  })

  // --- onMissingLocale: 'omit' (version-locale ledger gate) ---------------

  it('omit: returns the document for a detail read when the locale is available', async () => {
    const id = await createDoc({
      title: { en: 'Hello', de: 'Hallo' },
      body: { en: 'World', de: 'Welt' },
      sku: 'S1',
    })

    const doc = await queryBuilders.documents.getDocumentById({
      collection_id: testCollection.id,
      document_id: id,
      locale: 'de',
      onMissingLocale: 'omit',
    })
    expect(doc?.fields).toMatchObject({ title: 'Hallo', body: 'Welt' })
  })

  it('omit: returns null for a detail read when the locale is unavailable', async () => {
    // Partial `de` (body missing) → not available in `de`.
    const id = await createDoc({
      title: { en: 'Hello', de: 'Hallo' },
      body: { en: 'World' },
      sku: 'S2',
    })

    const strict = await queryBuilders.documents.getDocumentById({
      collection_id: testCollection.id,
      document_id: id,
      locale: 'de',
      onMissingLocale: 'omit',
    })
    expect(strict, 'strict resolves to null → caller 404s').toBeNull()

    // 'fallback' still returns it, rendered in the default locale.
    const always = await queryBuilders.documents.getDocumentById({
      collection_id: testCollection.id,
      document_id: id,
      locale: 'de',
      onMissingLocale: 'fallback',
    })
    expect(always?.fields.title).toBe('Hello')
  })

  it('omit: includes a locale-agnostic document (no localized content)', async () => {
    const id = await createDoc({ sku: 'S3' })

    const doc = await queryBuilders.documents.getDocumentById({
      collection_id: testCollection.id,
      document_id: id,
      locale: 'de',
      onMissingLocale: 'omit',
    })
    expect(doc?.fields.sku, 'the "all" sentinel row makes it available everywhere').toBe('S3')
  })

  it('omit: excludes untranslated documents from a list query', async () => {
    const translated = await createDoc({
      title: { en: 'T-en', de: 'T-de' },
      body: { en: 'b', de: 'b-de' },
      sku: 'S4',
    })
    const untranslated = await createDoc({
      title: { en: 'U-en' },
      body: { en: 'b' },
      sku: 'S5',
    })

    const strict = await queryBuilders.documents.findDocuments({
      collection_id: testCollection.id,
      locale: 'de',
      onMissingLocale: 'omit',
      pageSize: 200,
    })
    const strictIds = new Set(strict.documents.map((d) => d.document_id))
    expect(strictIds.has(translated), 'translated doc kept').toBe(true)
    expect(strictIds.has(untranslated), 'untranslated doc excluded').toBe(false)

    // A non-'omit' read (here the default 'empty') includes the untranslated
    // doc, and its total is strictly larger — proving 'omit' gates at the
    // SQL layer (pagination-safe).
    const unfiltered = await queryBuilders.documents.findDocuments({
      collection_id: testCollection.id,
      locale: 'de',
      pageSize: 200,
    })
    const unfilteredIds = new Set(unfiltered.documents.map((d) => d.document_id))
    expect(unfilteredIds.has(untranslated)).toBe(true)
    expect(strict.total).toBeLessThan(unfiltered.total)
  })

  // --- backfill (pre-existing versions) ------------------------------------

  it('backfillVersionLocales rebuilds the ledger for versions missing rows', async () => {
    const created = await commandBuilders.documents.createDocumentVersion({
      collectionId: testCollection.id,
      collectionVersion: 1,
      collectionConfig: LocaleCollectionConfig,
      action: 'create',
      documentData: {
        title: { en: 'Hello', de: 'Hallo' },
        body: { en: 'World', de: 'Welt' },
        sku: 'B1',
      },
      path: `loc-backfill-${timestamp}`,
      locale: 'all',
      status: 'published',
    })
    const versionId = created.document.id
    const documentId = created.document.document_id

    // Simulate a version written before the ledger existed: drop its rows.
    await db.execute(
      sql`DELETE FROM byline_document_version_locales WHERE document_version_id = ${versionId}::uuid`
    )

    const before = await queryBuilders.documents.getDocumentById({
      collection_id: testCollection.id,
      document_id: documentId,
      locale: 'de',
      onMissingLocale: 'omit',
    })
    expect(before, 'ledger removed → strict can no longer see it').toBeNull()

    // Backfill rebuilds it from the persisted content.
    const result = await commandBuilders.documents.backfillVersionLocales()
    expect(result.rowsInserted).toBeGreaterThan(0)

    const after = await queryBuilders.documents.getDocumentById({
      collection_id: testCollection.id,
      document_id: documentId,
      locale: 'de',
      onMissingLocale: 'omit',
    })
    expect(after?.fields.title, 'strict can see it again, rendered in de').toBe('Hallo')

    // Idempotent: a second run inserts nothing (everything already covered).
    const second = await commandBuilders.documents.backfillVersionLocales()
    expect(second.rowsInserted).toBe(0)
  })

  it('backfillSourceLocales stamps NULL source_locale rows with the default locale', async () => {
    const id = await createDoc({
      title: { en: 'Hello', de: 'Hallo' },
      body: { en: 'World', de: 'Welt' },
      sku: 'S1',
    })

    // The write path now stamps source_locale on create (Slice 2), so simulate
    // a row written before the column existed by nulling it — exactly the
    // pre-existing-data shape backfill exists to repair.
    await db.execute(sql`UPDATE byline_documents SET source_locale = NULL WHERE id = ${id}::uuid`)
    const before = await db.execute(
      sql`SELECT source_locale FROM byline_documents WHERE id = ${id}::uuid`
    )
    expect((before.rows[0] as { source_locale: string | null }).source_locale).toBeNull()

    const result = await commandBuilders.documents.backfillSourceLocales()
    expect(result.rowsUpdated).toBeGreaterThan(0)

    const after = await db.execute(
      sql`SELECT source_locale FROM byline_documents WHERE id = ${id}::uuid`
    )
    expect(
      (after.rows[0] as { source_locale: string | null }).source_locale,
      'stamped with the adapter default content locale (en)'
    ).toBe('en')

    // Idempotent: a second run touches nothing (no NULL rows remain).
    const second = await commandBuilders.documents.backfillSourceLocales()
    expect(second.rowsUpdated).toBe(0)
  })

  // --- source_locale write path (Slice 2) ----------------------------------

  it('records source_locale on create and writes the path row under it', async () => {
    const created = await commandBuilders.documents.createDocumentVersion({
      collectionId: testCollection.id,
      collectionVersion: 1,
      collectionConfig: LocaleCollectionConfig,
      action: 'create',
      documentData: { title: { en: 'Hello' }, sku: 'SL1' },
      path: `loc-source-${timestamp}`,
      locale: 'all',
      status: 'published',
    })
    const documentId = created.document.document_id

    // A new document is anchored to the configured default (en).
    const doc = await db.execute(
      sql`SELECT source_locale FROM byline_documents WHERE id = ${documentId}::uuid`
    )
    expect((doc.rows[0] as { source_locale: string }).source_locale).toBe('en')

    // Its path row lives under that source locale, not a hardcoded default.
    const paths = await db.execute(
      sql`SELECT locale FROM byline_document_paths WHERE document_id = ${documentId}::uuid`
    )
    expect(paths.rows.map((r) => (r as { locale: string }).locale)).toEqual(['en'])
  })

  it('keys the completeness ledger off the document source_locale, not the global default', async () => {
    // en has only {title}; de has {title, body}. Anchored to en, the canonical
    // checklist is {title} and both locales cover it. Re-anchored to de, the
    // checklist becomes {title, body} and only de covers it.
    const content = {
      title: { en: 'Hello', de: 'Hallo' },
      body: { de: 'Welt' },
      sku: 'SL2',
    }
    const v1 = await commandBuilders.documents.createDocumentVersion({
      collectionId: testCollection.id,
      collectionVersion: 1,
      collectionConfig: LocaleCollectionConfig,
      action: 'create',
      documentData: content,
      path: `loc-anchor-${timestamp}`,
      locale: 'all',
      status: 'published',
    })
    const documentId = v1.document.document_id
    const v1Id = v1.document.id

    // Anchored to en: canonical {title} → both en and de are complete.
    const ledgerV1 = await db.execute(
      sql`SELECT locale FROM byline_document_version_locales WHERE document_version_id = ${v1Id}::uuid ORDER BY locale`
    )
    expect(ledgerV1.rows.map((r) => (r as { locale: string }).locale)).toEqual(['de', 'en'])

    // Simulate a re-anchor: flip the document's source_locale to de.
    await db.execute(
      sql`UPDATE byline_documents SET source_locale = 'de' WHERE id = ${documentId}::uuid`
    )

    // A new version now computes canonical against de {title, body}; en no
    // longer covers it (missing body), so only de is complete.
    const v2 = await commandBuilders.documents.createDocumentVersion({
      documentId,
      collectionId: testCollection.id,
      collectionVersion: 1,
      collectionConfig: LocaleCollectionConfig,
      action: 'update',
      documentData: content,
      locale: 'all',
      status: 'published',
      previousVersionId: v1Id,
    })
    const v2Id = v2.document.id

    const ledgerV2 = await db.execute(
      sql`SELECT locale FROM byline_document_version_locales WHERE document_version_id = ${v2Id}::uuid ORDER BY locale`
    )
    expect(
      ledgerV2.rows.map((r) => (r as { locale: string }).locale),
      'canonical re-based onto de: only de is complete'
    ).toEqual(['de'])
  })

  it('backfillVersionLocales recomputes the ledger against each document source_locale', async () => {
    const content = {
      title: { en: 'Hi', de: 'Hallo' },
      body: { de: 'Welt' },
      sku: 'SL3',
    }
    const created = await commandBuilders.documents.createDocumentVersion({
      collectionId: testCollection.id,
      collectionVersion: 1,
      collectionConfig: LocaleCollectionConfig,
      action: 'create',
      documentData: content,
      path: `loc-backfill-anchor-${timestamp}`,
      locale: 'all',
      status: 'published',
    })
    const documentId = created.document.document_id
    const versionId = created.document.id

    // Re-anchor to de and wipe the (en-computed) ledger to simulate a version
    // whose ledger predates the re-anchor.
    await db.execute(
      sql`UPDATE byline_documents SET source_locale = 'de' WHERE id = ${documentId}::uuid`
    )
    await db.execute(
      sql`DELETE FROM byline_document_version_locales WHERE document_version_id = ${versionId}::uuid`
    )

    await commandBuilders.documents.backfillVersionLocales()

    // Rebuilt against de {title, body}: only de is complete (en lacks body).
    const ledger = await db.execute(
      sql`SELECT locale FROM byline_document_version_locales WHERE document_version_id = ${versionId}::uuid ORDER BY locale`
    )
    expect(ledger.rows.map((r) => (r as { locale: string }).locale)).toEqual(['de'])
  })

  // --- source_locale read path (Slice 3) -----------------------------------

  it('field fallback resolves to the document source_locale, not the global default', async () => {
    // Content lives only in de; the global default is en (no en content here).
    const id = await createDoc({ title: { de: 'Hallo' }, body: { de: 'Welt' }, sku: 'RD1' })
    // Re-anchor the document to de (global default stays en).
    await db.execute(sql`UPDATE byline_documents SET source_locale = 'de' WHERE id = ${id}::uuid`)

    // A fr read (absent) with fallback walks the chain [fr, <source=de>] and
    // resolves de — NOT the global default en, which has no content here and
    // would render empty.
    const detail = await readById(id, 'fr', 'fallback')
    expect(detail?.fields).toMatchObject({ title: 'Hallo', body: 'Welt', sku: 'RD1' })
    expect(detail?.source_locale).toBe('de')

    // Same per-document floor across a list query (exercises reconstructDocuments
    // + the batched field fetch, which collects per-row source locales).
    const { documents } = await queryBuilders.documents.findDocuments({
      collection_id: testCollection.id,
      locale: 'fr',
      onMissingLocale: 'fallback',
      pageSize: 100,
    })
    const listed = documents.find((d) => d.document_id === id)
    expect(listed?.fields.title, 'list row falls back to its own source de').toBe('Hallo')
  })

  it('projects the path under the document source_locale floor', async () => {
    const id = await createDoc({ title: { de: 'Hallo' }, sku: 'RP1' })
    const pathRow = await db.execute(
      sql`SELECT path FROM byline_document_paths WHERE document_id = ${id}::uuid`
    )
    const slug = (pathRow.rows[0] as { path: string }).path

    // Proper re-anchor: move both the anchor and the path row to de.
    await db.execute(sql`UPDATE byline_documents SET source_locale = 'de' WHERE id = ${id}::uuid`)
    await db.execute(
      sql`UPDATE byline_document_paths SET locale = 'de' WHERE document_id = ${id}::uuid`
    )

    // A fr read projects path via [fr, <source=de>] → finds the de path row.
    // If the floor were the global default en, the (now-de) row wouldn't match
    // and path would come back empty.
    const detail = await readById(id, 'fr', 'fallback')
    expect(detail?.path).toBe(slug)
  })

  // --- availability metadata (Phase 6: _availableVersionLocales) -----------

  it('exposes _availableVersionLocales + _localeAgnostic on a detail read', async () => {
    const id = await createDoc({
      title: { en: 'Hello', de: 'Hallo' },
      body: { en: 'World', de: 'Welt' },
      sku: 'M1',
    })

    const doc = await readById(id, 'en')
    expect(doc?._availableVersionLocales, 'sorted concrete locales').toEqual(['de', 'en'])
    expect(doc?._localeAgnostic).toBe(false)
  })

  it('flags a locale-agnostic document (no localized content)', async () => {
    const id = await createDoc({ sku: 'M2' })

    const doc = await readById(id, 'en')
    expect(doc?._availableVersionLocales).toEqual([])
    expect(doc?._localeAgnostic, 'the "all" sentinel surfaces as _localeAgnostic').toBe(true)
  })

  it('exposes _availableVersionLocales per row on a list read', async () => {
    const both = await createDoc({
      title: { en: 'B-en', de: 'B-de' },
      body: { en: 'x', de: 'y' },
      sku: 'M3',
    })
    const enOnly = await createDoc({
      title: { en: 'C-en' },
      body: { en: 'x' },
      sku: 'M4',
    })

    const { documents } = await queryBuilders.documents.findDocuments({
      collection_id: testCollection.id,
      locale: 'en',
      pageSize: 200,
    })
    const byId = new Map(documents.map((d) => [d.document_id, d]))
    expect(byId.get(both)?._availableVersionLocales).toEqual(['de', 'en'])
    expect(byId.get(enOnly)?._availableVersionLocales).toEqual(['en'])
  })
})
