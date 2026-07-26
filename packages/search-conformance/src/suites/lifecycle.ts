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

export function lifecycleSuite(hooks: SearchConformanceHooks): void {
  let provider: SearchProvider

  describe.sequential('SearchProvider document lifecycle and scope', () => {
    beforeEach(async () => {
      await hooks.reset()
      provider = await hooks.createProvider()
    })

    it('replaces one logical row idempotently on upsert', async () => {
      const original = searchDocument('alpha report', { documentId: 'replace-me' })
      await provider.upsert(original)
      await provider.upsert({
        ...original,
        title: 'beta report',
        fields: [{ ...original.fields[0]!, value: 'beta report' }],
      })

      await expect(
        provider.search({ query: 'alpha', collectionPath: original.collectionPath })
      ).resolves.toMatchObject({ total: 0 })
      await expect(
        provider.search({ query: 'beta', collectionPath: original.collectionPath })
      ).resolves.toMatchObject({
        total: 1,
        hits: [{ documentId: 'replace-me', title: 'beta report' }],
      })
    })

    it('applies collection, zone, locale, and published-status scopes', async () => {
      const documents = [
        searchDocument('scope marker', {
          documentId: 'collection-a-en',
          collectionPath: 'collection-a',
          zones: ['shared-zone'],
        }),
        searchDocument('scope marker', {
          documentId: 'collection-b-fr',
          collectionPath: 'collection-b',
          locale: 'fr',
          zones: ['shared-zone'],
        }),
        searchDocument('scope marker', {
          documentId: 'collection-a-draft',
          collectionPath: 'collection-a',
          status: 'draft',
          zones: ['draft-zone'],
        }),
      ]
      await Promise.all(documents.map((document) => provider.upsert(document)))

      await expect(
        provider.search({ query: 'scope', collectionPath: 'collection-a' })
      ).resolves.toMatchObject({ total: 1 })
      await expect(
        provider.search({ query: 'scope', zone: 'shared-zone', locale: 'fr' })
      ).resolves.toMatchObject({
        total: 1,
        hits: [{ documentId: 'collection-b-fr', locale: 'fr' }],
      })
      await expect(provider.search({ query: 'scope', zone: 'draft-zone' })).resolves.toMatchObject({
        total: 0,
      })
      await expect(
        provider.search({ query: 'scope', zone: 'draft-zone', status: 'any' })
      ).resolves.toMatchObject({ total: 1 })
    })

    it('returns stable pagination with a corpus-wide total', async () => {
      const updatedAt = '2026-07-26T00:00:00.000Z'
      for (const documentId of ['page-a', 'page-b', 'page-c']) {
        await provider.upsert(searchDocument('pagination marker', { documentId, updatedAt }))
      }

      const first = await provider.search({
        query: 'pagination',
        collectionPath: 'search-conformance',
        limit: 1,
      })
      const second = await provider.search({
        query: 'pagination',
        collectionPath: 'search-conformance',
        limit: 1,
        offset: 1,
      })

      expect(first).toMatchObject({ total: 3 })
      expect(second).toMatchObject({ total: 3 })
      expect(first.hits).toHaveLength(1)
      expect(second.hits).toHaveLength(1)
      expect(first.hits[0]?.documentId).toBe('page-a')
      expect(second.hits[0]?.documentId).toBe('page-b')
    })

    it('removes one locale or every locale for a document', async () => {
      const english = searchDocument('localized marker', {
        documentId: 'localized',
        locale: 'en',
      })
      const french = searchDocument('localized marker', {
        documentId: 'localized',
        locale: 'fr',
      })
      await provider.upsert(english)
      await provider.upsert(french)

      await provider.remove({
        collectionPath: english.collectionPath,
        documentId: english.documentId,
        locale: 'en',
      })
      await expect(
        provider.search({
          query: 'localized',
          collectionPath: english.collectionPath,
          locale: 'en',
        })
      ).resolves.toMatchObject({ total: 0 })
      await expect(
        provider.search({
          query: 'localized',
          collectionPath: english.collectionPath,
          locale: 'fr',
        })
      ).resolves.toMatchObject({ total: 1 })

      await provider.remove({
        collectionPath: english.collectionPath,
        documentId: english.documentId,
      })
      await expect(
        provider.search({ query: 'localized', collectionPath: english.collectionPath })
      ).resolves.toMatchObject({ total: 0 })
    })

    it('clears one collection or the complete index for rebuilding', async () => {
      await provider.upsert(
        searchDocument('reindex marker', {
          documentId: 'reindex-a',
          collectionPath: 'reindex-a',
        })
      )
      await provider.upsert(
        searchDocument('reindex marker', {
          documentId: 'reindex-b',
          collectionPath: 'reindex-b',
        })
      )

      await provider.reindex({ collectionPath: 'reindex-a' })
      await expect(
        provider.search({ query: 'reindex', collectionPath: 'reindex-a' })
      ).resolves.toMatchObject({ total: 0 })
      await expect(
        provider.search({ query: 'reindex', collectionPath: 'reindex-b' })
      ).resolves.toMatchObject({ total: 1 })

      await provider.reindex({})
      await expect(provider.search({ query: 'reindex', status: 'any' })).resolves.toMatchObject({
        total: 0,
      })
    })
  })
}
