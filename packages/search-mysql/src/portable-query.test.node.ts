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

import { buildPortableMySqlQuery } from './portable-query.js'

const expander: SearchTokenExpander = {
  fingerprint: 'english-test1',
  supports: (locale) => locale.startsWith('en'),
  expand: (token) => (token.value === 'running' ? [{ kind: 'stem', value: 'run' }] : []),
}

describe('buildPortableMySqlQuery', () => {
  it('keeps alternatives grouped by source concept', () => {
    const analyzer = createPortableSearchAnalyzer({ expanders: [expander] })
    const translated = buildPortableMySqlQuery(
      analyzer.analyzeQuery({ query: 'running restoration', locale: 'en' })
    )

    expect(translated.conceptQueries).toHaveLength(2)
    expect(translated.conceptQueries[0]).toContain(
      encodeSqlToken({ kind: 'exact', value: 'running' })
    )
    expect(translated.conceptQueries[0]).toContain(encodeSqlToken({ kind: 'stem', value: 'run' }))
    expect(translated.operator).toBe('all')
  })

  it('preserves phrase order and minimum-should-match intent', () => {
    const translated = buildPortableMySqlQuery(
      createPortableSearchAnalyzer().analyzeQuery({
        query: '"forest restoration" database',
        matching: { operator: 'any', minimumShouldMatch: 2 },
      })
    )

    expect(translated.conceptQueries).toHaveLength(3)
    expect(translated.phraseQueries[0]?.[0]).toMatch(/^"[a-z0-9]+ [a-z0-9]+"$/)
    expect(translated.minimumShouldMatch).toBe(2)
  })

  it('emits only phrase variants that mirror physical index streams', () => {
    const phraseExpander: SearchTokenExpander = {
      fingerprint: 'phrase-test1',
      supports: (locale) => locale.startsWith('en'),
      expand: (token) =>
        token.value === 'running'
          ? [{ kind: 'stem', value: 'run' }]
          : token.value === 'restoration'
            ? [{ kind: 'stem', value: 'restore' }]
            : [],
    }
    const translated = buildPortableMySqlQuery(
      createPortableSearchAnalyzer({ expanders: [phraseExpander] }).analyzeQuery({
        query: '"running restoration"',
        locale: 'en',
      })
    )

    expect(translated.phraseQueries[0]).toEqual([
      `"${encodeSqlToken({ kind: 'exact', value: 'running' })} ${encodeSqlToken({
        kind: 'exact',
        value: 'restoration',
      })}"`,
      `"${encodeSqlToken({ kind: 'stem', value: 'run' })} ${encodeSqlToken({
        kind: 'stem',
        value: 'restore',
      })}"`,
    ])
  })

  it('returns an empty ranking query for punctuation-only input', () => {
    const translated = buildPortableMySqlQuery(
      createPortableSearchAnalyzer().analyzeQuery({ query: '— -- !!!' })
    )

    expect(translated).toMatchObject({
      conceptQueries: [],
      phraseQueries: [],
      gramQueries: [],
      rankingQuery: '',
    })
  })
})
