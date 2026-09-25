/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Search is public delivery. Indexing writes only publicly eligible locale
 * slices (the source, or a checked and complete translation) and never a
 * fallback copy under a translated locale. At query time every public hit is
 * re-checked for exact-locale eligibility, so an index entry that outlived a
 * withdrawn checkbox is dropped whole (title and highlights with it), and the
 * restricted-result convention applies: `total` is the retained-hit count and
 * provider facets are omitted.
 */

import { createSuperAdminContext } from '@byline/auth'
import type { CollectionDefinition, SearchProvider, SearchResults } from '@byline/core'
import { migrate, postgresSearch } from '@byline/search-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type BylineClient, createBylineClient } from '../../src/index.js'
import {
  type MultiCollectionTestContext,
  setupMultiCollectionTestClient,
} from '../fixtures/setup.js'

const suffix = `${Date.now()}-locale-search-${Math.floor(Math.random() * 1e6)}`
const zone = `locale-zone-${suffix}`

const Articles: CollectionDefinition = {
  path: `locale-search-articles-${suffix}`,
  labels: { singular: 'Article', plural: 'Articles' },
  useAsTitle: 'title',
  advertiseLocales: true,
  search: { body: ['title', 'summary'], zones: [zone] },
  fields: [
    { name: 'title', type: 'text', localized: true, optional: true },
    { name: 'summary', type: 'textArea', localized: true, optional: true },
  ],
}

let ctx: MultiCollectionTestContext
let client: BylineClient
let provider: SearchProvider

/**
 * Query the provider directly — bypassing the client's post-ranking
 * eligibility check — to observe what the index actually holds.
 */
async function indexed(query: string, locale: string): Promise<string[]> {
  const results = await provider.search({
    query,
    collectionPath: Articles.path,
    locale,
    status: 'published',
  })
  return results.hits.map((h) => h.documentId)
}

async function seed(en: [string, string], es: [string, string]): Promise<string> {
  const created = await ctx.db.commands.documents.createDocumentVersion({
    collectionId: ctx.collectionIds[Articles.path] as string,
    collectionVersion: 1,
    collectionConfig: Articles,
    action: 'create',
    documentData: {
      title: { en: en[0], es: es[0] },
      summary: { en: en[1], es: es[1] },
    },
    path: `article-${suffix}-${en[0].toLowerCase().replace(/\s+/g, '-')}`,
    locale: 'all',
    status: 'published',
  })
  return created.document.document_id as string
}

function check(documentId: string, locales: string[]) {
  return ctx.db.commands.documents.setDocumentAvailableLocales({
    documentId,
    collectionId: ctx.collectionIds[Articles.path] as string,
    availableLocales: locales,
  })
}

const articles = () => client.collection(Articles.path)
const ids = (hits: Array<{ documentId: string }>) => hits.map((h) => h.documentId)

beforeAll(async () => {
  ctx = await setupMultiCollectionTestClient([Articles])
  await migrate(ctx.db.pool)
  // Index both content locales; the shared fixture configures only `en`.
  provider = postgresSearch({ pool: ctx.db.pool, defaultLocale: 'en' })
  client = createBylineClient({
    db: ctx.db,
    collections: [Articles],
    requestContext: createSuperAdminContext({ id: 'locale-search-super' }),
    search: provider,
    contentLocales: ['en', 'es'],
  })
}, 30_000)

afterAll(async () => {
  try {
    await ctx.db.commands.collections.delete(ctx.collectionIds[Articles.path] as string)
  } catch (err) {
    console.error('Failed to delete locale-search collection:', err)
  }
})

describe('indexing writes only publicly eligible locale slices (S1, observed in the index)', () => {
  it('indexes the source, and a complete translation only while it is checked', async () => {
    const id = await seed(['Orchard Alpha', 'apples'], ['Huerto Alpha', 'manzanas'])
    await articles().indexDocument(id)
    expect(await indexed('orchard', 'en'), 'source slice').toContain(id)
    expect(await indexed('huerto', 'es'), 'unchecked translation').not.toContain(id)
    expect(await indexed('orchard', 'es'), 'no fallback copy under es').not.toContain(id)

    await check(id, ['es'])
    await articles().indexDocument(id)
    expect(await indexed('huerto', 'es'), 'checked complete translation').toContain(id)
    expect(await indexed('orchard', 'es')).not.toContain(id)

    // Withdrawing leaves a stale slice until reconciliation removes it.
    await check(id, [])
    expect(await indexed('huerto', 'es'), 'stale before reconciliation').toContain(id)
    await articles().indexDocument(id)
    expect(await indexed('huerto', 'es'), 'removed by reconciliation').not.toContain(id)
    expect(await indexed('orchard', 'en')).toContain(id)
  })

  it('never indexes a checked but incomplete translation', async () => {
    const created = await ctx.db.commands.documents.createDocumentVersion({
      collectionId: ctx.collectionIds[Articles.path] as string,
      collectionVersion: 1,
      collectionConfig: Articles,
      action: 'create',
      // Spanish translates the title only.
      documentData: {
        title: { en: 'Meadow Delta', es: 'Pradera Delta' },
        summary: { en: 'grass' },
      },
      path: `article-${suffix}-meadow`,
      locale: 'all',
      status: 'published',
    })
    const id = created.document.document_id as string
    await check(id, ['es'])
    await articles().indexDocument(id)
    expect(await indexed('pradera', 'es')).not.toContain(id)
    expect(await indexed('meadow', 'en')).toContain(id)
  })

  it('indexes the published version, never a newer draft (V2)', async () => {
    // Published: Spanish title only (incomplete). A newer draft completes it.
    const created = await ctx.db.commands.documents.createDocumentVersion({
      collectionId: ctx.collectionIds[Articles.path] as string,
      collectionVersion: 1,
      collectionConfig: Articles,
      action: 'create',
      documentData: { title: { en: 'River Echo', es: 'Rio Echo' }, summary: { en: 'water' } },
      path: `article-${suffix}-river`,
      locale: 'all',
      status: 'published',
    })
    const id = created.document.document_id as string
    await check(id, ['es'])
    const draft = await ctx.db.commands.documents.createDocumentVersion({
      documentId: id,
      collectionId: ctx.collectionIds[Articles.path] as string,
      collectionVersion: 1,
      collectionConfig: Articles,
      action: 'update',
      documentData: { title: 'Rio Echo', summary: 'agua caudal' },
      locale: 'es',
      status: 'draft',
      previousVersionId: created.document.id,
    })
    await articles().indexDocument(id)
    expect(await indexed('caudal', 'es'), 'draft-only content').not.toContain(id)
    expect(await indexed('rio', 'es'), 'incomplete published Spanish').not.toContain(id)

    // Publishing the draft makes Spanish complete on the selected version.
    await ctx.db.commands.documents.setDocumentStatus({
      document_version_id: draft.document.id,
      status: 'published',
    })
    await ctx.db.commands.documents.archivePublishedVersions({
      document_id: id,
      excludeVersionId: draft.document.id,
    })
    await articles().indexDocument(id)
    expect(await indexed('caudal', 'es')).toContain(id)
  })

  it('the SDK reindex orchestration applies the same policy', async () => {
    const eligible = await seed(['Harbor Foxtrot', 'boats'], ['Puerto Foxtrot', 'barcos'])
    const withheld = await seed(['Canyon Golf', 'rocks'], ['Canon Golf', 'rocas'])
    await check(eligible, ['es'])
    // A stale withheld slice already in the index before the rebuild.
    await check(withheld, ['es'])
    await articles().indexDocument(withheld)
    await check(withheld, [])
    expect(await indexed('canon', 'es')).toContain(withheld)

    const result = await articles().reindex()
    expect(result.documents).toBeGreaterThanOrEqual(2)
    expect(await indexed('puerto', 'es')).toContain(eligible)
    expect(await indexed('canon', 'es'), 'rebuild drops the withheld slice').not.toContain(withheld)
    expect(await indexed('canyon', 'en')).toContain(withheld)
  })
})

describe('query-time eligibility drops stale hits (S2, S3)', () => {
  let stale: string

  beforeAll(async () => {
    stale = await seed(['Vineyard Beta', 'grapes'], ['Vinedo Beta', 'uvas'])
    await check(stale, ['es'])
    await articles().indexDocument(stale)
  })

  it('returns the hit, with the provider total, while the translation is checked', async () => {
    const results = await articles().search({ query: 'vinedo', locale: 'es' })
    expect(ids(results.hits)).toContain(stale)
    expect(results.hits.find((h) => h.documentId === stale)?.title).toBe('Vinedo Beta')
  })

  describe('after the checkbox is withdrawn without reindexing', () => {
    beforeAll(async () => {
      // The index still holds the Spanish slice until reconciliation runs.
      await check(stale, [])
    })

    it('drops the whole hit from collection search, without hydration or a hook', async () => {
      const results = await articles().search({ query: 'vinedo', locale: 'es' })
      expect(ids(results.hits)).not.toContain(stale)
      // Restricted-result convention: retained-hit total, no provider facets.
      expect(results.total).toBe(results.hits.length)
      expect(results.facets).toBeUndefined()
    })

    it('drops it from hydrated search too, never substituting the source', async () => {
      const results = await articles().search({ query: 'vinedo', locale: 'es', hydrate: true })
      expect(ids(results.hits)).not.toContain(stale)
    })

    it('drops it even when beforeRead is bypassed', async () => {
      const results = await articles().search({
        query: 'vinedo',
        locale: 'es',
        _bypassBeforeRead: true,
      })
      expect(ids(results.hits)).not.toContain(stale)
    })

    it('drops it from zone search', async () => {
      const results = await client.search({ query: 'vinedo', zone, locale: 'es' })
      expect(ids(results.hits)).not.toContain(stale)
      expect(results.total).toBe(results.hits.length)
      expect(results.facets).toBeUndefined()
    })

    it('a provider page made only of stale hits comes back short, not refilled', async () => {
      const results = await articles().search({
        query: 'vinedo',
        locale: 'es',
        limit: 1,
        offset: 0,
      })
      expect(results.hits).toEqual([])
      expect(results.total).toBe(0)
    })

    it('reindexing restores index consistency', async () => {
      await articles().indexDocument(stale)
      const results = await articles().search({ query: 'vinedo', locale: 'es' })
      expect(ids(results.hits)).not.toContain(stale)
    })
  })
})

// ---------------------------------------------------------------------------
// Public aggregates follow the restricted convention whenever the policy
// applies (F1): a page-only check cannot certify provider totals or facets.
// ---------------------------------------------------------------------------

describe('public aggregates are restricted whenever the eligibility policy applies', () => {
  let eligibleId: string
  let stubClient: BylineClient
  let next: SearchResults

  beforeAll(async () => {
    eligibleId = await seed(['Stub Hotel', 'one'], ['Stub Hotel ES', 'uno'])
    const stub: SearchProvider = {
      capabilities: provider.capabilities,
      upsert: async () => {},
      remove: async () => {},
      reindex: async () => {},
      search: async () => next,
    } as SearchProvider
    stubClient = createBylineClient({
      db: ctx.db,
      collections: [Articles],
      requestContext: createSuperAdminContext({ id: 'locale-search-stub' }),
      search: stub,
      contentLocales: ['en', 'es'],
    })
  })

  const eligibleHit = () => ({
    collectionPath: Articles.path,
    documentId: eligibleId,
    locale: 'en',
    title: 'Stub Hotel',
    path: null,
    score: 1,
  })
  const facets = { topic: [{ value: 'stale-bucket', count: 2 }] }

  it.each([
    [
      'collection',
      () => stubClient.collection(Articles.path).search({ query: 'stub', locale: 'en' }),
    ],
    ['zone', () => stubClient.search({ query: 'stub', zone, locale: 'en' })],
  ] as const)(
    '%s search: an empty offset page does not expose a stale match counted elsewhere',
    async (_name, run) => {
      next = { hits: [], total: 1, facets }
      const results = await run()
      expect(results.hits).toEqual([])
      expect(results.total).toBe(0)
      expect(results.facets).toBeUndefined()
    }
  )

  it.each([
    [
      'collection',
      () => stubClient.collection(Articles.path).search({ query: 'stub', locale: 'en' }),
    ],
    ['zone', () => stubClient.search({ query: 'stub', zone, locale: 'en' })],
  ] as const)(
    '%s search: an all-eligible page does not pass through the provider aggregate',
    async (_name, run) => {
      next = { hits: [eligibleHit()], total: 2, facets }
      const results = await run()
      expect(results.hits.map((h) => h.documentId)).toEqual([eligibleId])
      expect(results.total).toBe(1)
      expect(results.facets).toBeUndefined()
    }
  )

  it('an editorial search keeps the provider aggregate (no public policy)', async () => {
    next = { hits: [eligibleHit()], total: 2, facets }
    const results = await stubClient
      .collection(Articles.path)
      .search({ query: 'stub', locale: 'en', status: 'any' })
    expect(results.total).toBe(2)
    expect(results.facets).toEqual(facets)
  })
})
