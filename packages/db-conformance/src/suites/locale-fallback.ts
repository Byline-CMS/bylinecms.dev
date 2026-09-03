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
 * here is `'en'` (see the hooks' adapter construction), so a `'de'` read falls
 * back to `'en'` only under `onMissingLocale: 'fallback'`.
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
 *
 * The Postgres original also covers the `source_locale` internals (the
 * version-locale completeness ledger, re-anchoring, and the config-default
 * flip) by reaching past the adapter into raw SQL against
 * `byline_document_version_locales` / `byline_documents` / `byline_document_paths`
 * to set up and verify states no `IDbAdapter` method exposes. Those tests stay
 * in
 * `packages/db-postgres/src/modules/storage/tests/storage-locale-fallback.test.ts`
 * as Postgres-specific coverage; this suite carries only the parts observable
 * purely through the adapter contract.
 */

import { type CollectionDefinition, ErrorCodes, type IDbAdapter } from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ConformanceHooks } from '../index.js'

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

// The reconstructed read shape — `getDocumentById` returns a union of the
// reconstructed and raw-flattened branches; `readById` never passes
// `reconstruct: false`, so narrow to the reconstructed branch (the only one
// carrying the locale metadata) here rather than at every assertion site.
type ReconstructedRead = {
  document_version_id: string
  fields: Record<string, any>
  source_locale: string
  _availableVersionLocales: string[]
  _localeAgnostic: boolean
}

/**
 * Ported (behavioural subset) from
 * `packages/db-postgres/src/modules/storage/tests/storage-locale-fallback.test.ts`.
 */
export function localeFallbackSuite(hooks: ConformanceHooks): void {
  let adapter: IDbAdapter
  let testCollection: { id: string; name: string } = {} as any
  let seq = 0

  async function createVersionedDoc(suffix: string) {
    const documentData = {
      title: { en: `Original EN ${suffix}`, de: `Original DE ${suffix}` },
      body: { en: `Body EN ${suffix}`, de: `Body DE ${suffix}` },
      sku: `parent-${suffix}`,
    }
    return adapter.commands.documents.createDocumentVersion({
      collectionId: testCollection.id,
      collectionVersion: 1,
      collectionConfig: LocaleCollectionConfig,
      action: 'create',
      documentData,
      path: `parent-${timestamp}-${suffix}`,
      locale: 'all',
      status: 'draft',
    })
  }

  function writeLocale(params: {
    documentId: string
    previousVersionId?: string
    locale: 'en' | 'de'
    suffix: string
  }) {
    const { documentId, previousVersionId, locale, suffix } = params
    return adapter.commands.documents.createDocumentVersion({
      documentId,
      collectionId: testCollection.id,
      collectionVersion: 1,
      collectionConfig: LocaleCollectionConfig,
      action: 'update',
      documentData: {
        title: `Updated ${locale.toUpperCase()} ${suffix}`,
        body: `Updated body ${locale.toUpperCase()} ${suffix}`,
        sku: `parent-${suffix}`,
      },
      locale,
      status: 'draft',
      previousVersionId,
    })
  }

  /** Create a logical document from a multi-locale (`'all'`) field tree. */
  async function createDoc(documentData: Record<string, unknown>): Promise<string> {
    seq += 1
    const result = await adapter.commands.documents.createDocumentVersion({
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

  function readById(
    documentId: string,
    locale: string,
    onMissingLocale?: 'empty' | 'fallback' | 'omit'
  ) {
    return adapter.queries.documents.getDocumentById({
      collection_id: testCollection.id,
      document_id: documentId,
      locale,
      onMissingLocale,
    }) as Promise<ReconstructedRead | null>
  }

  describe('content-locale resolution & fallback', () => {
    beforeAll(async () => {
      await hooks.truncate()
      adapter = await hooks.createAdapter([LocaleCollectionConfig])

      const result = await adapter.commands.collections.create(
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
        await adapter.commands.collections.delete(testCollection.id)
      } catch (error) {
        console.error('Failed to cleanup test collection:', error)
      }
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

      const { documents } = await adapter.queries.documents.findDocuments({
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

      const doc = await adapter.queries.documents.getDocumentById({
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

      const strict = await adapter.queries.documents.getDocumentById({
        collection_id: testCollection.id,
        document_id: id,
        locale: 'de',
        onMissingLocale: 'omit',
      })
      expect(strict, 'strict resolves to null → caller 404s').toBeNull()

      // 'fallback' still returns it, rendered in the default locale.
      const always = await adapter.queries.documents.getDocumentById({
        collection_id: testCollection.id,
        document_id: id,
        locale: 'de',
        onMissingLocale: 'fallback',
      })
      expect(always?.fields.title).toBe('Hello')
    })

    it('omit: includes a locale-agnostic document (no localized content)', async () => {
      const id = await createDoc({ sku: 'S3' })

      const doc = await adapter.queries.documents.getDocumentById({
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

      const strict = await adapter.queries.documents.findDocuments({
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
      const unfiltered = await adapter.queries.documents.findDocuments({
        collection_id: testCollection.id,
        locale: 'de',
        pageSize: 200,
      })
      const unfilteredIds = new Set(unfiltered.documents.map((d) => d.document_id))
      expect(unfilteredIds.has(untranslated)).toBe(true)
      expect(strict.total).toBeLessThan(unfiltered.total)
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

      const { documents } = await adapter.queries.documents.findDocuments({
        collection_id: testCollection.id,
        locale: 'en',
        pageSize: 200,
      })
      const byId = new Map(documents.map((d) => [d.document_id, d]))
      expect(byId.get(both)?._availableVersionLocales).toEqual(['de', 'en'])
      expect(byId.get(enOnly)?._availableVersionLocales).toEqual(['en'])
    })

    describe('version parent integrity', () => {
      it('rejects a stale previousVersionId without creating another version', async () => {
        const initial = await createVersionedDoc('stale')
        const documentId = initial.document.document_id as string
        const current = await writeLocale({
          documentId,
          previousVersionId: initial.document.id as string,
          locale: 'en',
          suffix: 'stale',
        })

        await expect(
          writeLocale({
            documentId,
            previousVersionId: initial.document.id as string,
            locale: 'de',
            suffix: 'stale',
          })
        ).rejects.toMatchObject({
          code: ErrorCodes.CONFLICT,
          details: {
            reason: 'stale',
            documentId,
            previousVersionId: initial.document.id,
            currentVersionId: current.document.id,
          },
        })

        const stored = await readById(documentId, 'all')
        expect(stored?.document_version_id).toBe(current.document.id)
        expect(stored?.fields.title).toEqual({
          en: 'Updated EN stale',
          de: 'Original DE stale',
        })
      })

      it('rejects an omitted parent for a locale-scoped existing-document write', async () => {
        const initial = await createVersionedDoc('missing')
        const documentId = initial.document.document_id as string

        await expect(
          writeLocale({ documentId, locale: 'de', suffix: 'missing' })
        ).rejects.toMatchObject({
          code: ErrorCodes.CONFLICT,
          details: {
            reason: 'missing',
            documentId,
            previousVersionId: null,
            currentVersionId: initial.document.id,
          },
        })

        const stored = await readById(documentId, 'all')
        expect(stored?.document_version_id).toBe(initial.document.id)
      })

      it('allows one concurrent locale save and rejects the other stale parent', async () => {
        const initial = await createVersionedDoc('concurrent')
        const documentId = initial.document.document_id as string
        const previousVersionId = initial.document.id as string

        const outcomes = await Promise.allSettled([
          writeLocale({ documentId, previousVersionId, locale: 'en', suffix: 'concurrent' }),
          writeLocale({ documentId, previousVersionId, locale: 'de', suffix: 'concurrent' }),
        ])
        const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled')
        const rejected = outcomes.filter((outcome) => outcome.status === 'rejected')

        expect(fulfilled).toHaveLength(1)
        expect(rejected).toHaveLength(1)
        expect(rejected[0]).toMatchObject({ reason: { code: ErrorCodes.CONFLICT } })

        const stored = await readById(documentId, 'all')
        if (outcomes[0]?.status === 'fulfilled') {
          expect(stored?.fields.title).toEqual({
            en: 'Updated EN concurrent',
            de: 'Original DE concurrent',
          })
        } else {
          expect(stored?.fields.title).toEqual({
            en: 'Original EN concurrent',
            de: 'Updated DE concurrent',
          })
        }
      })

      it('rejects sequential locale writes that reuse a parent inside withTransaction', async () => {
        const initial = await createVersionedDoc('transaction')
        const documentId = initial.document.document_id as string
        const previousVersionId = initial.document.id as string

        await expect(
          adapter.withTransaction(async () => {
            await writeLocale({
              documentId,
              previousVersionId,
              locale: 'en',
              suffix: 'transaction',
            })
            await writeLocale({
              documentId,
              previousVersionId,
              locale: 'de',
              suffix: 'transaction',
            })
          })
        ).rejects.toMatchObject({ code: ErrorCodes.CONFLICT })

        const stored = await readById(documentId, 'all')
        expect(stored?.document_version_id).toBe(initial.document.id)
        expect(stored?.fields.title).toEqual({
          en: 'Original EN transaction',
          de: 'Original DE transaction',
        })
      })
    })

    // The re-anchor coverage ("no-ops when the document is already anchored
    // to the target", "bulk re-anchors complete documents...", and every
    // ledger/source_locale-internals test) stays in
    // packages/db-postgres/src/modules/storage/tests/storage-locale-fallback.test.ts
    // — `reAnchorDocument` / `reAnchorDocuments` / `backfillVersionLocales`
    // are Postgres-only maintenance operations documented as off the core
    // `IDbAdapter` contract, so they aren't something a conforming adapter is
    // required to implement.
  })
}
