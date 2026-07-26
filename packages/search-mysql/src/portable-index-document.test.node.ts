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

import { buildPortableMySqlIndexDocument } from './portable-index-document.js'
import type { IndexRow } from './build-index-row.js'

const expander: SearchTokenExpander = {
  fingerprint: 'english-test1',
  supports: (locale) => locale.startsWith('en'),
  expand: (token) => (token.value === 'running' ? [{ kind: 'stem', value: 'run' }] : []),
}

function row(overrides: Partial<IndexRow> = {}): IndexRow {
  return {
    collectionPath: 'reports',
    documentId: 'report-1',
    locale: 'en',
    status: 'published',
    zones: ['library'],
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

describe('buildPortableMySqlIndexDocument', () => {
  it('keeps exact terms at source weight and lowers derived variants', () => {
    const analyzer = createPortableSearchAnalyzer({ expanders: [expander] })
    const document = buildPortableMySqlIndexDocument(row(), analyzer)
    const exact = encodeSqlToken({ kind: 'exact', value: 'running' })
    const stem = encodeSqlToken({ kind: 'stem', value: 'run' })

    expect(document.weighted.A).toContain(exact)
    expect(document.weighted.A).not.toContain(stem)
    expect(document.weighted.B).toContain(stem)
    expect(document.analyzerFingerprint).toBe(analyzer.fingerprint)
  })

  it('always assigns Han grams to the lightest weight class', () => {
    const document = buildPortableMySqlIndexDocument(row(), createPortableSearchAnalyzer())

    expect(document.weighted.D).toContain(encodeSqlToken({ kind: 'gram', value: '数据' }))
    expect(document.weighted.D).toContain(encodeSqlToken({ kind: 'gram', value: '据库' }))
  })

  it('inserts unsearchable boundaries between independent streams', () => {
    const document = buildPortableMySqlIndexDocument(
      row({ weighted: { A: 'alpha', B: 'beta', C: '', D: '' } }),
      createPortableSearchAnalyzer()
    )

    expect(document.searchText).toContain('bylinefulltextboundary')
  })

  it('uses exact fallbacks beside derived terms in matching streams', () => {
    const analyzer = createPortableSearchAnalyzer({ expanders: [expander] })
    const document = buildPortableMySqlIndexDocument(
      row({ weighted: { A: 'running restoration', B: '', C: '', D: '' } }),
      analyzer
    )
    const stem = encodeSqlToken({ kind: 'stem', value: 'run' })
    const exactNeighbor = encodeSqlToken({ kind: 'exact', value: 'restoration' })

    expect(document.searchText).toContain(`${stem} ${exactNeighbor}`)
  })
})
