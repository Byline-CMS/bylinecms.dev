/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Postgres-specific residual of the content-locale resolution coverage.
 *
 * The behavioural half of the original file — the `onMissingLocale` read
 * switch (`'empty'` | `'fallback'` | `'omit'`) and the `_availableVersionLocales`
 * / `_localeAgnostic` read metadata — ported verbatim to `@byline/db-conformance`'s
 * `locale-fallback` suite (`packages/db-conformance/src/suites/locale-fallback.ts`),
 * now run via `packages/db-postgres/tests/conformance.integration.test.ts`.
 *
 * These tests stay behind because they either:
 *   - reach past the adapter into raw SQL against
 *     `byline_document_version_locales` / `byline_documents` /
 *     `byline_document_paths` to set up or verify internal invariants (the
 *     completeness ledger, the `source_locale` column, a deliberately
 *     desynced path/locale) that no `IDbAdapter` method exposes, or
 *   - exercise `reAnchorDocument` / `reAnchorDocuments` / `backfillVersionLocales`,
 *     Postgres-only maintenance operations documented as off the core
 *     `IDbAdapter` contract (no `@byline/core` service depends on them), so
 *     they aren't something a conforming adapter is required to implement.
 */

import type { CollectionDefinition } from '@byline/core'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'
import { createQueryBuilders } from '../storage-queries.js'

let commandBuilders: ReturnType<typeof import('../storage-commands.js').createCommandBuilders>
let queryBuilders: ReturnType<typeof import('../storage-queries.js').createQueryBuilders>
let db: ReturnType<typeof setupTestDB>['db']

const timestamp = Date.now()

const LocaleCollectionConfig: CollectionDefinition = {
  path: `locale-fallback-internals-${timestamp}`,
  labels: { singular: 'LocaleInternalsTest', plural: 'LocaleInternalsTests' },
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
    path: `loc-internals-${timestamp}-${seq}`,
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

describe('content-locale resolution — source_locale internals (Postgres)', () => {
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

  // --- config-default flip safety (Slice 4) --------------------------------

  it('a global default flip leaves existing documents intact (they ride source_locale)', async () => {
    // Authored under the en default → source_locale 'en', en content, en path.
    const id = await createDoc({ title: { en: 'Hello' }, body: { en: 'World' }, sku: 'FS1' })
    const pathRow = await db.execute(
      sql`SELECT path FROM byline_document_paths WHERE document_id = ${id}::uuid`
    )
    const slug = (pathRow.rows[0] as { path: string }).path

    // Simulate the global default switched to fr: a fresh query layer built
    // with defaultContentLocale = 'fr' over the very same rows.
    const frQueries = createQueryBuilders(db, [LocaleCollectionConfig], 'fr')

    // Detail read in fr (the NEW default) with fallback: the doc has no fr
    // content, but rides its own source_locale 'en' floor → returns the en
    // content. A naive [fr]-only chain (pre-source_locale) would render empty.
    const detail = (await frQueries.documents.getDocumentById({
      collection_id: testCollection.id,
      document_id: id,
      locale: 'fr',
      onMissingLocale: 'fallback',
    })) as ReconstructedRead | null
    expect(detail?.fields).toMatchObject({ title: 'Hello', body: 'World', sku: 'FS1' })
    expect(detail?.source_locale).toBe('en')

    // The path still resolves when looked up under the document's own source
    // locale (its URL didn't move when the global default flipped).
    const byPath = await frQueries.documents.getDocumentByPath({
      collection_id: testCollection.id,
      path: slug,
      locale: 'en',
      reconstruct: true,
    })
    expect(byPath?.document_id).toBe(id)

    // List read under the fr default still surfaces the en content per-row.
    const { documents } = await frQueries.documents.findDocuments({
      collection_id: testCollection.id,
      locale: 'fr',
      onMissingLocale: 'fallback',
      pageSize: 200,
    })
    expect(documents.find((d) => d.document_id === id)?.fields.title).toBe('Hello')
  })

  // --- re-anchor (Slice 5) -------------------------------------------------
  // Placed last: the bulk re-anchor mutates every complete document in the
  // collection, so no later test should depend on the pre-re-anchor state.

  it('re-anchors a complete document: flips source, moves the path, writes a new version', async () => {
    const id = await createDoc({
      title: { en: 'Hello', de: 'Hallo' },
      body: { en: 'World', de: 'Welt' },
      sku: 'RA1',
    })
    const pathRow = await db.execute(
      sql`SELECT path FROM byline_document_paths WHERE document_id = ${id}::uuid`
    )
    const slug = (pathRow.rows[0] as { path: string }).path
    const before = await db.execute(
      sql`SELECT count(*)::int AS n FROM byline_document_versions WHERE document_id = ${id}::uuid`
    )

    const result = await commandBuilders.documents.reAnchorDocument({
      documentId: id,
      targetLocale: 'de',
    })
    expect(result.status).toBe('reanchored')
    expect(result.fromLocale).toBe('en')
    expect(result.toLocale).toBe('de')
    expect(result.newVersionId).toBeTruthy()

    // Anchor flipped.
    const doc = await db.execute(
      sql`SELECT source_locale FROM byline_documents WHERE id = ${id}::uuid`
    )
    expect((doc.rows[0] as { source_locale: string }).source_locale).toBe('de')

    // Path row moved to de (same slug), with no en row left behind.
    const paths = await db.execute(
      sql`SELECT locale, path FROM byline_document_paths WHERE document_id = ${id}::uuid`
    )
    expect(paths.rows).toEqual([{ locale: 'de', path: slug }])

    // A new immutable version was written and is now current.
    const after = await db.execute(
      sql`SELECT count(*)::int AS n FROM byline_document_versions WHERE document_id = ${id}::uuid`
    )
    expect((after.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n + 1)

    // Content preserved verbatim across the copy.
    const all = await readById(id, 'all')
    expect(all?.fields.title).toEqual({ en: 'Hello', de: 'Hallo' })
    expect(all?.fields.body).toEqual({ en: 'World', de: 'Welt' })
    expect(all?.fields.sku).toBe('RA1')
    expect(all?.source_locale).toBe('de')

    // New version's ledger computed against de (both locales cover it).
    const ledger = await db.execute(
      sql`SELECT locale FROM byline_document_version_locales WHERE document_version_id = ${result.newVersionId}::uuid ORDER BY locale`
    )
    expect(ledger.rows.map((r) => (r as { locale: string }).locale)).toEqual(['de', 'en'])
  })

  it('refuses to re-anchor a document not complete in the target', async () => {
    // en is full {title, body}; de has only title → de does not cover en.
    const id = await createDoc({
      title: { en: 'Hi', de: 'Hallo' },
      body: { en: 'World' },
      sku: 'RA2',
    })
    const result = await commandBuilders.documents.reAnchorDocument({
      documentId: id,
      targetLocale: 'de',
    })
    expect(result.status).toBe('skipped-incomplete')

    const doc = await db.execute(
      sql`SELECT source_locale FROM byline_documents WHERE id = ${id}::uuid`
    )
    expect((doc.rows[0] as { source_locale: string }).source_locale).toBe('en')
    const versions = await db.execute(
      sql`SELECT count(*)::int AS n FROM byline_document_versions WHERE document_id = ${id}::uuid`
    )
    expect((versions.rows[0] as { n: number }).n).toBe(1)
  })

  it('no-ops when the document is already anchored to the target', async () => {
    const id = await createDoc({ title: { en: 'Hello' }, sku: 'RA3' })
    const result = await commandBuilders.documents.reAnchorDocument({
      documentId: id,
      targetLocale: 'en',
    })
    expect(result.status).toBe('already-anchored')
  })

  it('treats a locale-agnostic document as eligible for any target', async () => {
    const id = await createDoc({ sku: 'RA4' })
    const result = await commandBuilders.documents.reAnchorDocument({
      documentId: id,
      targetLocale: 'de',
    })
    expect(result.status).toBe('reanchored')
    const doc = await db.execute(
      sql`SELECT source_locale FROM byline_documents WHERE id = ${id}::uuid`
    )
    expect((doc.rows[0] as { source_locale: string }).source_locale).toBe('de')
  })

  it('dryRun reports the would-be outcome without writing', async () => {
    const id = await createDoc({
      title: { en: 'Hello', de: 'Hallo' },
      body: { en: 'World', de: 'Welt' },
      sku: 'RA5',
    })
    const result = await commandBuilders.documents.reAnchorDocument({
      documentId: id,
      targetLocale: 'de',
      dryRun: true,
    })
    expect(result.status).toBe('reanchored')

    const doc = await db.execute(
      sql`SELECT source_locale FROM byline_documents WHERE id = ${id}::uuid`
    )
    expect((doc.rows[0] as { source_locale: string }).source_locale).toBe('en')
    const versions = await db.execute(
      sql`SELECT count(*)::int AS n FROM byline_document_versions WHERE document_id = ${id}::uuid`
    )
    expect((versions.rows[0] as { n: number }).n).toBe(1)
  })

  it('bulk re-anchors complete documents and reports the incomplete ones', async () => {
    const complete = await createDoc({
      title: { en: 'C', de: 'C-de' },
      body: { en: 'B', de: 'B-de' },
      sku: 'RB1',
    })
    const incomplete = await createDoc({
      title: { en: 'I', de: 'I-de' },
      body: { en: 'B' }, // no de body → incomplete in de
      sku: 'RB2',
    })

    const report = await commandBuilders.documents.reAnchorDocuments({
      targetLocale: 'de',
      collectionId: testCollection.id,
    })

    const byId = new Map(report.results.map((r) => [r.documentId, r]))
    expect(byId.get(complete)?.status).toBe('reanchored')
    expect(byId.get(incomplete)?.status).toBe('skipped-incomplete')
    expect(report.total).toBeGreaterThanOrEqual(2)
    expect(report.reanchored).toBeGreaterThanOrEqual(1)
    expect(report.skippedIncomplete).toBeGreaterThanOrEqual(1)
  })
})
