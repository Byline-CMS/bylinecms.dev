/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { SearchProvider } from '@byline/core'
import { createPortableSearchAnalyzer, type SearchTokenExpander } from '@byline/search-analysis'
import { beforeEach, describe, expect, it } from 'vitest'

import { bodyField, searchDocument } from '../fixtures.js'
import type { SearchConformanceHooks } from '../index.js'

export function portableAnalysisSuite(hooks: SearchConformanceHooks): void {
  if (hooks.createPortableProvider == null) return

  const createProvider = hooks.createPortableProvider
  let provider: SearchProvider

  describe.sequential('portable SearchProvider analysis', () => {
    beforeEach(async () => {
      await hooks.reset()
      provider = await createProvider(createPortableSearchAnalyzer())
    })

    it('preserves normalized terms, SQL stopwords, and protected identifiers', async () => {
      await provider.upsert(
        searchDocument('ＴＨＥ Node.js SKU-1234 editor@example.com', {
          documentId: 'portable-identifiers',
        })
      )

      for (const query of ['the', 'Node.js', 'SKU-1234', 'editor@example.com']) {
        const result = await provider.search({
          query,
          collectionPath: 'search-conformance',
        })
        expect(result.total, query).toBe(1)
        expect(result.hits[0]?.score, query).toBeGreaterThan(0)
      }
    })

    it('retains recall for SKU constituents without leaking URL or email components', async () => {
      await provider.upsert(
        searchDocument(
          'COVID-19 cases use utf-8 encoding. Contact editor@example.com at https://example.org/docs.',
          { documentId: 'portable-identifier-constituents' }
        )
      )

      for (const query of ['covid', '19', 'covid-19', 'utf', '8', 'utf-8']) {
        await expect(
          provider.search({ query, collectionPath: 'search-conformance' }),
          query
        ).resolves.toMatchObject({
          total: 1,
          hits: [{ documentId: 'portable-identifier-constituents' }],
        })
      }
      for (const query of ['example', 'docs']) {
        await expect(
          provider.search({ query, collectionPath: 'search-conformance' }),
          query
        ).resolves.toMatchObject({ total: 0 })
      }
      await expect(
        provider.search({
          query: '"covid-19 cases"',
          collectionPath: 'search-conformance',
        })
      ).resolves.toMatchObject({
        total: 1,
        hits: [{ documentId: 'portable-identifier-constituents' }],
      })
    })

    it('matches ordered Han-bigram substrings with a positive score', async () => {
      await provider.upsert(
        searchDocument('数据库搜索', {
          documentId: 'portable-han',
          locale: 'zh',
        })
      )

      const result = await provider.search({
        query: '据库搜',
        collectionPath: 'search-conformance',
        locale: 'zh',
      })
      expect(result).toMatchObject({
        total: 1,
        hits: [{ documentId: 'portable-han' }],
      })
      expect(result.hits[0]?.score).toBeGreaterThan(0)
    })

    it('indexes exact-preserving language expansions symmetrically', async () => {
      const expander: SearchTokenExpander = {
        fingerprint: 'search-conformance-english1',
        supports: (locale) => locale.startsWith('en'),
        expand: (token) =>
          token.value === 'running' || token.value === 'runs'
            ? [{ kind: 'stem', value: 'run' }]
            : [],
      }
      provider = await createProvider(createPortableSearchAnalyzer({ expanders: [expander] }))
      await provider.upsert(searchDocument('running', { documentId: 'portable-expansion' }))

      await expect(
        provider.search({ query: 'runs', collectionPath: 'search-conformance' })
      ).resolves.toMatchObject({
        total: 1,
        hits: [{ documentId: 'portable-expansion' }],
      })
      await expect(
        provider.search({ query: 'running', collectionPath: 'search-conformance' })
      ).resolves.toMatchObject({ total: 1 })
    })

    it('preserves phrase adjacency across expansions and exact fallbacks', async () => {
      const expander: SearchTokenExpander = {
        fingerprint: 'search-conformance-phrase-english1',
        supports: (locale) => locale.startsWith('en'),
        expand: (token) =>
          token.value === 'running' || token.value === 'runs'
            ? [{ kind: 'stem', value: 'run' }]
            : [],
      }
      provider = await createProvider(createPortableSearchAnalyzer({ expanders: [expander] }))
      await provider.upsert(
        searchDocument('running restoration', {
          documentId: 'portable-expansion-phrase',
        })
      )

      await expect(
        provider.search({
          query: '"runs restoration"',
          collectionPath: 'search-conformance',
        })
      ).resolves.toMatchObject({
        total: 1,
        hits: [{ documentId: 'portable-expansion-phrase' }],
      })
    })

    it('ranks a heavier field above the same term in a lighter field', async () => {
      if (!provider.capabilities.weighting) return
      await provider.upsert(
        searchDocument('heavy result', {
          documentId: 'weight-heavy',
          fields: [bodyField('weighted', 2)],
        })
      )
      await provider.upsert(
        searchDocument('light result', {
          documentId: 'weight-light',
          fields: [bodyField('weighted', 0.1)],
        })
      )

      const result = await provider.search({
        query: 'weighted',
        collectionPath: 'search-conformance',
      })
      expect(result.total).toBe(2)
      expect(result.hits[0]?.documentId).toBe('weight-heavy')
      expect(result.hits[0]?.score).toBeGreaterThan(result.hits[1]?.score ?? 0)
    })

    it('rejects mixed analyzer fingerprints until the collection is rebuilt', async () => {
      const collectionPath = 'fingerprint-guard'
      const original = await createProvider(createPortableSearchAnalyzer({ defaultLocale: 'en' }))
      const changed = await createProvider(createPortableSearchAnalyzer({ defaultLocale: 'th' }))
      const document = searchDocument('fingerprint marker', {
        collectionPath,
        documentId: 'fingerprint-document',
      })

      await original.upsert(document)
      await expect(changed.search({ query: 'fingerprint', collectionPath })).rejects.toMatchObject({
        code: 'SEARCH_INDEX_REINDEX_REQUIRED',
        collectionPath,
      })
      await expect(
        changed.search({ query: 'fingerprint', zone: 'search-conformance' })
      ).rejects.toMatchObject({
        code: 'SEARCH_INDEX_REINDEX_REQUIRED',
        collectionPath,
      })
      await expect(changed.upsert(document)).rejects.toMatchObject({
        code: 'SEARCH_INDEX_REINDEX_REQUIRED',
        collectionPath,
      })

      await changed.reindex({ collectionPath })
      await changed.upsert(document)
      await expect(changed.search({ query: 'fingerprint', collectionPath })).resolves.toMatchObject(
        { total: 1 }
      )
    })
  })
}
