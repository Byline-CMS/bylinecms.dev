/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { expect, it } from 'vitest'

import { MAX_RANGE_FACET_BUCKETS } from '../index.js'
import type {
  SearchQuery,
  SearchRangeFacetBucket,
  SearchRangeFacetRequest,
  SearchResults,
} from '../index.js'

it('exports the range-facet contract and bucket cap from the public core entry point', () => {
  const request: SearchRangeFacetRequest = { field: 'year', start: 2000, end: 2003, gap: 2 }
  const buckets: SearchRangeFacetBucket[] = [
    { start: 2000, end: 2002, count: 0 },
    { start: 2002, end: 2003, count: 1 },
  ]
  const query: SearchQuery = { query: '', rangeFacets: [request] }
  const result: SearchResults = { hits: [], total: 1, rangeFacets: { year: buckets } }
  expect(MAX_RANGE_FACET_BUCKETS).toBe(200)
  expect(query.rangeFacets).toEqual([request])
  expect(result.rangeFacets?.year).toEqual(buckets)
})
