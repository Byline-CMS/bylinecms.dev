/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { SearchDocument } from '@byline/core'
import { describe, expect, it } from 'vitest'

import { buildIndexRow, weightClass } from './build-index-row.js'

const base: SearchDocument = {
  collectionPath: 'reports',
  documentId: 'report-1',
  locale: 'en',
  status: 'published',
  zones: ['library'],
  title: 'Display title',
  path: 'display-title',
  updatedAt: '2026-07-26T00:00:00.000Z',
  fields: [],
}

describe('weightClass', () => {
  it('uses role defaults and maps boost magnitudes consistently', () => {
    expect(weightClass(undefined, 'B')).toBe('B')
    expect(weightClass(2, 'B')).toBe('A')
    expect(weightClass(1, 'B')).toBe('B')
    expect(weightClass(0.5, 'B')).toBe('C')
    expect(weightClass(0.1, 'B')).toBe('D')
  })
})

describe('buildIndexRow', () => {
  it('projects weighted body, facet terms and ids, and typed filters', () => {
    const row = buildIndexRow({
      ...base,
      fields: [
        { name: 'title', type: 'text', role: 'body', value: 'Heavy title', boost: 2 },
        { name: 'summary', type: 'text', role: 'body', value: 'Ordinary summary' },
        {
          name: 'topics',
          type: 'facet',
          role: 'facet',
          value: [{ id: 12, term: 'Forestry' }],
        },
        { name: 'year', type: 'integer', role: 'filter', value: 2026 },
      ],
    })

    expect(row.weighted).toEqual({
      A: 'Heavy title',
      B: 'Ordinary summary',
      C: 'Forestry',
      D: '',
    })
    expect(row.body).toBe('Heavy title\nOrdinary summary\nForestry')
    expect(row.facets).toEqual({ topics: [{ id: 12, term: 'Forestry' }] })
    expect(row.filters).toEqual({ year: 2026 })
  })

  it('keeps the display title out of search unless projected as body', () => {
    expect(buildIndexRow(base).body).toBe('')
  })
})
