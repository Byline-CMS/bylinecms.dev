/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { SearchProvider } from '@byline/core'
import { beforeEach, describe, expect, it } from 'vitest'

import { searchDocument } from '../fixtures.js'
import type { SearchConformanceHooks } from '../index.js'

export function lexicalMatchingSuite(hooks: SearchConformanceHooks): void {
  let provider: SearchProvider

  describe.sequential('SearchProvider lexical matching', () => {
    beforeEach(async () => {
      await hooks.reset()
      provider = await hooks.createProvider()
    })

    it('implements all, any, and minimum-should-match by source concept', async () => {
      await provider.upsert(searchDocument('forest restoration database'))

      await expect(
        provider.search({
          query: 'forest missing',
          collectionPath: 'search-conformance',
          matching: { operator: 'all' },
        })
      ).resolves.toMatchObject({ total: 0 })
      await expect(
        provider.search({
          query: 'forest missing',
          collectionPath: 'search-conformance',
          matching: { operator: 'any' },
        })
      ).resolves.toMatchObject({ total: 1 })
      await expect(
        provider.search({
          query: 'forest restoration missing',
          collectionPath: 'search-conformance',
          matching: { operator: 'any', minimumShouldMatch: 2 },
        })
      ).resolves.toMatchObject({ total: 1 })
      await expect(
        provider.search({
          query: 'forest restoration missing',
          collectionPath: 'search-conformance',
          matching: { operator: 'any', minimumShouldMatch: 3 },
        })
      ).resolves.toMatchObject({ total: 0 })
    })

    it('preserves quoted and required phrase order and permits phrase opt-out', async () => {
      await provider.upsert(searchDocument('forest restoration', { documentId: 'phrase-exact' }))
      await provider.upsert(searchDocument('restoration forest', { documentId: 'phrase-reversed' }))
      await provider.upsert(
        searchDocument('forest habitat restoration', { documentId: 'phrase-separated' })
      )

      await expect(
        provider.search({
          query: '"forest restoration"',
          collectionPath: 'search-conformance',
        })
      ).resolves.toMatchObject({
        total: 1,
        hits: [{ documentId: 'phrase-exact' }],
      })
      await expect(
        provider.search({
          query: 'forest restoration',
          collectionPath: 'search-conformance',
          matching: { phrase: 'required' },
        })
      ).resolves.toMatchObject({
        total: 1,
        hits: [{ documentId: 'phrase-exact' }],
      })
      await expect(
        provider.search({
          query: '"forest restoration"',
          collectionPath: 'search-conformance',
          matching: { phrase: 'off' },
        })
      ).resolves.toMatchObject({ total: 3 })
    })

    it('returns an empty result for a query with no searchable concepts', async () => {
      await provider.upsert(searchDocument('punctuation marker'))

      await expect(
        provider.search({ query: '— -- !!!', collectionPath: 'search-conformance' })
      ).resolves.toEqual({ hits: [], total: 0 })
    })
  })
}
