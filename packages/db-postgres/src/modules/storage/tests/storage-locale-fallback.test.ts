/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Integration tests for content-locale resolution & fallback (Phase 1).
 *
 * Exercises the storage adapter's read path directly. A concrete-locale read
 * resolves a single *effective* locale per document via the fallback chain
 * `[requested, default]` and restores the whole document in it — never mixing
 * locales across fields. The default-content-locale here is `'en'` (see
 * test-helper), so a `'de'` read falls back to `'en'` content.
 *
 * Availability (Phase 1) is path-coverage against the default locale: a locale
 * is "available" only when it covers every localized field path the default
 * locale has. A partial translation is therefore *not* available and falls all
 * the way back — guaranteeing no German-title/English-body output.
 *
 *   - fully translated `de`            → renders `de`
 *   - partial `de` (title only)        → renders all `en` (no mixed fields)
 *   - no `de` at all                   → renders `en`
 *   - no localized content             → renders the non-localized values
 *   - `locale: 'all'` (admin read)     → keeps the per-locale map shape
 *   - list (findDocuments) mixed batch → per-version effective locale
 */

import type { CollectionDefinition } from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'

let commandBuilders: ReturnType<typeof import('../storage-commands.js').createCommandBuilders>
let queryBuilders: ReturnType<typeof import('../storage-queries.js').createQueryBuilders>

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

function readById(documentId: string, locale: string) {
  return queryBuilders.documents.getDocumentById({
    collection_id: testCollection.id,
    document_id: documentId,
    locale,
  })
}

describe('content-locale resolution & fallback', () => {
  beforeAll(async () => {
    const testDB = setupTestDB([LocaleCollectionConfig])
    commandBuilders = testDB.commandBuilders
    queryBuilders = testDB.queryBuilders

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

  it('falls back fully to default for a partial translation — never mixes locales', async () => {
    // `de` has a title but no body. Under path-coverage `de` is unavailable,
    // so the whole document renders in `en` — NOT { title: 'Hallo', body: 'World' }.
    const id = await createDoc({
      title: { en: 'Hello', de: 'Hallo' },
      body: { en: 'World' },
      sku: 'X2',
    })

    const doc = await readById(id, 'de')
    expect(doc?.fields).toMatchObject({ title: 'Hello', body: 'World', sku: 'X2' })
    expect(doc?.fields.title, 'must not show the orphan German title').not.toBe('Hallo')
  })

  it('falls back to default when the locale is entirely absent', async () => {
    const id = await createDoc({
      title: { en: 'Hello' },
      body: { en: 'World' },
      sku: 'X3',
    })

    const doc = await readById(id, 'de')
    expect(doc?.fields).toMatchObject({ title: 'Hello', body: 'World', sku: 'X3' })
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

  it('resolves an effective locale per document across a list query', async () => {
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
      pageSize: 100,
    })

    const byId = new Map(documents.map((d) => [d.document_id, d]))
    expect(byId.get(translated)?.fields.title).toBe('Listed DE')
    expect(byId.get(enOnly)?.fields.title, 'untranslated row falls back to en').toBe('EN Only')
  })

  // --- localeFallback: 'strict' (version-locale ledger gate) ---------------

  it('strict: returns the document for a detail read when the locale is available', async () => {
    const id = await createDoc({
      title: { en: 'Hello', de: 'Hallo' },
      body: { en: 'World', de: 'Welt' },
      sku: 'S1',
    })

    const doc = await queryBuilders.documents.getDocumentById({
      collection_id: testCollection.id,
      document_id: id,
      locale: 'de',
      localeFallback: 'strict',
    })
    expect(doc?.fields).toMatchObject({ title: 'Hallo', body: 'Welt' })
  })

  it('strict: returns null for a detail read when the locale is unavailable', async () => {
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
      localeFallback: 'strict',
    })
    expect(strict, 'strict resolves to null → caller 404s').toBeNull()

    // 'always' (default) still returns it, rendered in the default locale.
    const always = await queryBuilders.documents.getDocumentById({
      collection_id: testCollection.id,
      document_id: id,
      locale: 'de',
    })
    expect(always?.fields.title).toBe('Hello')
  })

  it('strict: includes a locale-agnostic document (no localized content)', async () => {
    const id = await createDoc({ sku: 'S3' })

    const doc = await queryBuilders.documents.getDocumentById({
      collection_id: testCollection.id,
      document_id: id,
      locale: 'de',
      localeFallback: 'strict',
    })
    expect(doc?.fields.sku, 'the "all" sentinel row makes it available everywhere').toBe('S3')
  })

  it('strict: excludes untranslated documents from a list query', async () => {
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
      localeFallback: 'strict',
      pageSize: 200,
    })
    const strictIds = new Set(strict.documents.map((d) => d.document_id))
    expect(strictIds.has(translated), 'translated doc kept').toBe(true)
    expect(strictIds.has(untranslated), 'untranslated doc excluded').toBe(false)

    // 'always' (default) includes the untranslated doc, and its total is
    // strictly larger — proving the gate filters at the SQL layer (pagination-safe).
    const always = await queryBuilders.documents.findDocuments({
      collection_id: testCollection.id,
      locale: 'de',
      pageSize: 200,
    })
    const alwaysIds = new Set(always.documents.map((d) => d.document_id))
    expect(alwaysIds.has(untranslated)).toBe(true)
    expect(strict.total).toBeLessThan(always.total)
  })
})
