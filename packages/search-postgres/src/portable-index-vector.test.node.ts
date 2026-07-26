/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  createPortableSearchAnalyzer,
  encodeSqlToken,
  type SearchTokenExpander,
} from '@byline/search-analysis'
import { describe, expect, it } from 'vitest'

import { buildPortableIndexVector } from './portable-index-vector.js'
import type { IndexRow } from './build-index-row.js'

const englishExpander: SearchTokenExpander = {
  fingerprint: 'english-test1',
  supports: (locale) => locale.startsWith('en'),
  expand: (token) => (token.value === 'running' ? [{ kind: 'stem', value: 'run' }] : []),
}

function row(overrides: Partial<IndexRow> = {}): IndexRow {
  return {
    collectionPath: 'publications',
    documentId: 'doc-1',
    locale: 'en',
    status: 'published',
    zones: ['site'],
    title: 'Running database',
    path: 'running-database',
    body: 'Running 数据库',
    weighted: { A: 'Running 数据库', B: '', C: '', D: '' },
    facets: {},
    filters: {},
    updatedAt: '2026-07-26T00:00:00.000Z',
    ...overrides,
  }
}

describe('buildPortableIndexVector', () => {
  it('keeps exact and derived terms at one position with lower derived weight', () => {
    const analyzer = createPortableSearchAnalyzer({ expanders: [englishExpander] })
    const vector = buildPortableIndexVector(row(), analyzer)
    const exact = encodeSqlToken({ kind: 'exact', value: 'running' })
    const stem = encodeSqlToken({ kind: 'stem', value: 'run' })

    expect(vector.value).toContain(`'${exact}':1A`)
    expect(vector.value).toContain(`'${stem}':1B`)
    expect(vector.analyzerFingerprint).toBe(analyzer.fingerprint)
  })

  it('always assigns Han grams to weight D', () => {
    const analyzer = createPortableSearchAnalyzer()
    const vector = buildPortableIndexVector(row(), analyzer)

    expect(vector.value).toContain(`'${encodeSqlToken({ kind: 'gram', value: '数据' })}':4D`)
    expect(vector.value).toContain(`'${encodeSqlToken({ kind: 'gram', value: '据库' })}':5D`)
  })

  it('separates weight buckets positionally', () => {
    const analyzer = createPortableSearchAnalyzer()
    const input = row({
      body: 'alpha\nbeta',
      weighted: { A: 'alpha', B: 'beta', C: '', D: '' },
    })
    const vector = buildPortableIndexVector(input, analyzer)
    const alpha = encodeSqlToken({ kind: 'exact', value: 'alpha' })
    const beta = encodeSqlToken({ kind: 'exact', value: 'beta' })

    expect(vector.value).toContain(`'${alpha}':1A`)
    expect(vector.value).toContain(`'${beta}':3B`)
  })
})
