/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { createPortableSearchAnalyzer } from './analyzer.js'
import { highlightPortableText } from './highlight.js'
import type { SearchTokenExpander } from './types.js'

describe('portable highlighting', () => {
  it('preserves original text while marking normalized terms and protected identifiers', () => {
    const analyzer = createPortableSearchAnalyzer()
    const plan = analyzer.analyzeQuery({
      query: 'alpha ffi Node.js',
      locale: 'en',
    })

    expect(
      highlightPortableText({
        text: 'Prelude words before Alpha compatibility ﬃ and Node.js finish.',
        plan,
        analyzer,
      })
    ).toBe(
      'Prelude words before <mark>Alpha</mark> compatibility <mark>ﬃ</mark> and <mark>Node.js</mark> finish.'
    )
  })

  it('marks source terms that matched through a language expansion', () => {
    const expander: SearchTokenExpander = {
      fingerprint: 'english-highlight-test1',
      supports: (locale) => locale.startsWith('en'),
      expand: (token) =>
        token.value === 'running' || token.value === 'runs' ? [{ kind: 'stem', value: 'run' }] : [],
    }
    const analyzer = createPortableSearchAnalyzer({ expanders: [expander] })
    const plan = analyzer.analyzeQuery({ query: 'runs', locale: 'en' })

    expect(
      highlightPortableText({
        text: 'Running through the forest.',
        plan,
        analyzer,
      })
    ).toBe('<mark>Running</mark> through the forest.')
  })

  it('marks only concepts present in a partial any-term match', () => {
    const analyzer = createPortableSearchAnalyzer()
    const plan = analyzer.analyzeQuery({
      query: 'forest missing',
      matching: { operator: 'any' },
    })

    expect(
      highlightPortableText({
        text: 'Forest restoration field notes.',
        plan,
        analyzer,
      })
    ).toBe('<mark>Forest</mark> restoration field notes.')
  })

  it('merges overlapping Han token and gram ranges', () => {
    const analyzer = createPortableSearchAnalyzer()
    const plan = analyzer.analyzeQuery({ query: '数据库' })

    expect(highlightPortableText({ text: '研究数据库系统', plan, analyzer })).toContain(
      '<mark>数据库</mark>'
    )
  })

  it('selects bounded fragments around distant matches', () => {
    const analyzer = createPortableSearchAnalyzer()
    const words = Array.from({ length: 60 }, (_, index) => `word${index}`)
    words[2] = 'alpha'
    words[55] = 'beta'
    const plan = analyzer.analyzeQuery({
      query: 'alpha beta',
      matching: { operator: 'any' },
    })

    const highlighted = highlightPortableText({
      text: words.join(' '),
      plan,
      analyzer,
      maxFragments: 2,
      maxWords: 8,
    })

    expect(highlighted).toContain('<mark>alpha</mark>')
    expect(highlighted).toContain('<mark>beta</mark>')
    expect(highlighted).toContain(' … ')
    expect(highlighted?.split(/\s+/)).toHaveLength(17)
  })

  it('returns undefined when the stored text contains no query term', () => {
    const analyzer = createPortableSearchAnalyzer()
    const plan = analyzer.analyzeQuery({ query: 'forest' })

    expect(highlightPortableText({ text: 'ocean', plan, analyzer })).toBeUndefined()
  })

  it('rejects incompatible analyzers and invalid limits', () => {
    const analyzer = createPortableSearchAnalyzer({ defaultLocale: 'en' })
    const plan = analyzer.analyzeQuery({ query: 'forest' })

    expect(() =>
      highlightPortableText({
        text: 'forest',
        plan,
        analyzer: createPortableSearchAnalyzer({ defaultLocale: 'th' }),
      })
    ).toThrow(/fingerprints/)
    expect(() =>
      highlightPortableText({ text: 'forest', plan, analyzer, maxFragments: 0 })
    ).toThrow(RangeError)
  })
})
