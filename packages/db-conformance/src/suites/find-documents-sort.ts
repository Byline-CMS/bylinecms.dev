/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Integration tests for the field-level sort direction in `findDocuments` —
 * the `sort` (`FieldSort`) path that joins one EAV store table laterally and
 * orders the page by that field's value.
 *
 * Two invariants, both of which a naive `ORDER BY <value> <direction>` gets
 * wrong on real content:
 *
 *   - Documents with no stored row for the sorted field (never filled in, or
 *     not translated into the requested locale) sort as empty. Empties stay at
 *     the bottom in BOTH directions — the admin list treats them as "missing",
 *     not as the smallest value.
 *   - Flipping the direction reverses the page even when the sort values tie.
 *     Sparse and low-cardinality fields (a checkbox where one document is
 *     ticked, a select where every row shares a term) otherwise produce
 *     byte-identical pages for ascending and descending, because the tied rows
 *     have nothing to order them by. A deterministic tiebreaker that follows
 *     the sort direction is what makes the flip observable — and what makes
 *     pagination stable across pages.
 */

import type { CollectionDefinition, IDbAdapter } from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ConformanceHooks } from '../index.js'

const timestamp = Date.now()

const SortCollectionConfig: CollectionDefinition = {
  path: `find-sort-${timestamp}`,
  labels: { singular: 'FindSortTest', plural: 'FindSortTests' },
  fields: [
    { name: 'title', type: 'text' },
    { name: 'featured', type: 'checkbox' },
  ],
}

export function findDocumentsSortSuite(hooks: ConformanceHooks): void {
  let adapter: IDbAdapter
  let testCollection: { id: string; name: string } = {} as any

  /**
   * Read one page ordered by `featured`, returning the titles in page order.
   * `pageSize` covers the whole fixture so the assertion is about ordering
   * alone, never about which rows made the page.
   */
  async function titlesByFeatured(direction: 'asc' | 'desc'): Promise<string[]> {
    const result = await adapter.queries.documents.findDocuments({
      collection_id: testCollection.id,
      sort: {
        fieldName: 'featured',
        storeType: 'boolean',
        valueColumn: 'value',
        direction,
      },
      locale: 'en',
      page: 1,
      pageSize: 50,
    })
    return result.documents.map((doc: any) => doc.fields.title as string)
  }

  describe('findDocuments field-level sort direction', () => {
    beforeAll(async () => {
      await hooks.truncate()
      adapter = await hooks.createAdapter([SortCollectionConfig])

      const result = await adapter.commands.collections.create(
        SortCollectionConfig.path,
        SortCollectionConfig
      )
      const collection = result[0]
      if (collection == null) {
        throw new Error('Failed to create test collection')
      }
      testCollection = { id: collection.id, name: collection.path }

      // One ticked document and three that were never touched — the shape a
      // checkbox column actually takes in an admin list. `featured: undefined`
      // writes no store row at all, so those three sort as empty.
      const seed: Array<{ title: string; featured?: boolean }> = [
        { title: 'Alpha', featured: true },
        { title: 'Bravo' },
        { title: 'Charlie' },
        { title: 'Delta' },
      ]
      for (const doc of seed) {
        await adapter.commands.documents.createDocumentVersion({
          collectionId: testCollection.id,
          collectionVersion: 1,
          collectionConfig: SortCollectionConfig,
          action: 'create',
          documentData: doc.featured === undefined ? { title: doc.title } : doc,
          locale: 'en',
          status: 'published',
        })
      }
    })

    afterAll(async () => {
      try {
        await adapter.commands.collections.delete(testCollection.id)
      } catch (error) {
        console.error('Failed to cleanup test collection:', error)
      }
    })

    it('keeps documents with no stored value at the bottom in both directions', async () => {
      const descending = await titlesByFeatured('desc')
      const ascending = await titlesByFeatured('asc')

      expect(descending[0]).toBe('Alpha')
      expect(ascending[0]).toBe('Alpha')
      expect(descending.slice(1).sort()).toEqual(['Bravo', 'Charlie', 'Delta'])
      expect(ascending.slice(1).sort()).toEqual(['Bravo', 'Charlie', 'Delta'])
    })

    it('reverses tied rows when the direction flips', async () => {
      const descending = await titlesByFeatured('desc')
      const ascending = await titlesByFeatured('asc')

      // Without a direction-following tiebreaker the two pages come back
      // byte-identical: the lone non-empty row leads both, and the three
      // empties tie with nothing to order them by.
      expect(descending).not.toEqual(ascending)
      expect(descending.slice(1)).toEqual([...ascending.slice(1)].reverse())
    })

    it('is stable across repeated reads in one direction', async () => {
      const first = await titlesByFeatured('desc')
      const second = await titlesByFeatured('desc')
      expect(first).toEqual(second)
    })
  })
}
