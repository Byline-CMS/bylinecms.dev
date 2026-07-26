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

import { buildPortablePostgresQuery } from './portable-query.js'

const expander: SearchTokenExpander = {
  fingerprint: 'english-test1',
  supports: (locale) => locale.startsWith('en'),
  expand: (token) => (token.value === 'running' ? [{ kind: 'stem', value: 'run' }] : []),
}

describe('buildPortablePostgresQuery', () => {
  it('keeps recall variants grouped inside all-concept matching', () => {
    const analyzer = createPortableSearchAnalyzer({ expanders: [expander] })
    const translated = buildPortablePostgresQuery(
      analyzer.analyzeQuery({ query: 'running restoration', locale: 'en' })
    )
    const exact = encodeSqlToken({ kind: 'exact', value: 'running' })
    const stem = encodeSqlToken({ kind: 'stem', value: 'run' })
    const restoration = encodeSqlToken({ kind: 'exact', value: 'restoration' })

    expect(translated.conceptTsqueries).toHaveLength(2)
    expect(translated.conceptTsqueries[0]).toContain(exact)
    expect(translated.conceptTsqueries[0]).toContain(stem)
    expect(translated.tsquery).toContain(' | ')
    expect(translated.tsquery).toContain(' & ')
    expect(translated.tsquery).toContain(restoration)
  })

  it('preserves phrase order and minimum-should-match inputs', () => {
    const analyzer = createPortableSearchAnalyzer()
    const translated = buildPortablePostgresQuery(
      analyzer.analyzeQuery({
        query: '"forest restoration" database',
        locale: 'en',
        matching: { operator: 'any', minimumShouldMatch: 2 },
      })
    )

    expect(translated.conceptTsqueries).toHaveLength(3)
    expect(translated.minimumShouldMatch).toBe(2)
    expect(translated.tsquery).toContain(' | ')
    expect(translated.tsquery).toContain(' <-> ')
    expect(translated.tsquery).toMatch(/^[a-z0-9()|&<>\-\s]+$/)
  })

  it('returns an empty translation for punctuation-only input', () => {
    const analyzer = createPortableSearchAnalyzer()
    const translated = buildPortablePostgresQuery(analyzer.analyzeQuery({ query: '---' }))

    expect(translated).toEqual({ tsquery: '', conceptTsqueries: [] })
  })
})
