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
import { createRegconfigResolver } from './locale-regconfig.js'

function doc(overrides: Partial<SearchDocument> = {}): SearchDocument {
  return {
    collectionPath: 'publications',
    documentId: 'doc-1',
    locale: 'en',
    status: 'published',
    zones: ['site'],
    title: 'Forest Restoration',
    path: 'forest-restoration',
    updatedAt: '2026-06-01T00:00:00.000Z',
    fields: [],
    ...overrides,
  }
}

describe('weightClass', () => {
  it('uses the role default when no boost is set', () => {
    expect(weightClass(undefined, 'B')).toBe('B')
    expect(weightClass(undefined, 'C')).toBe('C')
  })

  it('maps boost magnitude to a weight class', () => {
    expect(weightClass(2, 'B')).toBe('A')
    expect(weightClass(1, 'C')).toBe('B')
    expect(weightClass(0.5, 'B')).toBe('C')
    expect(weightClass(0.1, 'B')).toBe('D')
  })
})

describe('buildIndexRow', () => {
  it('weights the title into class A', () => {
    const row = buildIndexRow(doc())
    expect(row.weighted.A).toBe('Forest Restoration')
  })

  it('places body fields in B by default and respects boost', () => {
    const row = buildIndexRow(
      doc({
        fields: [
          { name: 'summary', type: 'text', role: 'body', value: 'A short summary.' },
          { name: 'abstract', type: 'text', role: 'body', value: 'Detailed abstract.', boost: 2 },
        ],
      })
    )
    expect(row.weighted.B).toBe('A short summary.')
    expect(row.weighted.A).toContain('Detailed abstract.')
  })

  it('projects facet ids into facets and folds terms into searchable text (class C)', () => {
    const row = buildIndexRow(
      doc({
        fields: [
          {
            name: 'topics',
            type: 'facet',
            role: 'facet',
            value: [
              { id: 1, term: 'Ecology' },
              { id: 2, term: 'Biodiversity' },
            ],
          },
        ],
      })
    )
    expect(row.facets).toEqual({
      topics: [
        { id: 1, term: 'Ecology' },
        { id: 2, term: 'Biodiversity' },
      ],
    })
    expect(row.weighted.C).toBe('Ecology\nBiodiversity')
  })

  it('projects filters and keeps them out of the search text', () => {
    const row = buildIndexRow(
      doc({
        fields: [
          { name: 'citationCount', type: 'integer', role: 'filter', value: 42 },
          { name: 'publishedYear', type: 'integer', role: 'filter', value: 2026 },
        ],
      })
    )
    expect(row.filters).toEqual({ citationCount: 42, publishedYear: 2026 })
    expect(row.body).toBe('Forest Restoration')
  })

  it('concatenates all weighted text into body for snippets', () => {
    const row = buildIndexRow(
      doc({
        fields: [
          { name: 'summary', type: 'text', role: 'body', value: 'Body text.' },
          { name: 'topics', type: 'facet', role: 'facet', value: [{ id: 1, term: 'Ecology' }] },
        ],
      })
    )
    expect(row.body).toBe('Forest Restoration\nBody text.\nEcology')
  })
})

describe('createRegconfigResolver', () => {
  const resolve = createRegconfigResolver()

  it('maps known locales (and their base) to a Postgres regconfig', () => {
    expect(resolve('en')).toBe('english')
    expect(resolve('fr')).toBe('french')
    expect(resolve('fr-CA')).toBe('french')
  })

  it('falls back to simple for unknown locales / undefined', () => {
    expect(resolve('th')).toBe('simple')
    expect(resolve(undefined)).toBe('simple')
  })

  it('honours overrides and a custom fallback', () => {
    const custom = createRegconfigResolver({ th: 'thai' }, 'english')
    expect(custom('th')).toBe('thai')
    expect(custom('xx')).toBe('english')
  })
})
