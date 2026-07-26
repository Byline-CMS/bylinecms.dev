/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { createPortableSearchAnalyzer, resolveMatching } from './analyzer.js'
import { detectSearchLocale, resolveSearchLocale } from './locale.js'
import { normalizeForSearch } from './normalize.js'
import type { SearchTokenExpander } from './types.js'

describe('portable search analysis', () => {
  it('normalizes compatibility forms while preserving original UTF-16 ranges', () => {
    const normalized = normalizeForSearch('A ﬃ Ｂ')

    expect(normalized.value).toBe('a ffi b')
    expect(normalized.originalRange(2, 5)).toEqual({ start: 2, end: 3 })

    const analyzed = createPortableSearchAnalyzer().analyzeText({ text: 'A ﬃ Ｂ' })
    expect(analyzed.exactTokens.map(({ value, start, end }) => ({ value, start, end }))).toEqual([
      { value: 'a', start: 0, end: 1 },
      { value: 'ffi', start: 2, end: 3 },
      { value: 'b', start: 4, end: 5 },
    ])
  })

  it('prefers a valid declared locale and otherwise falls back through script detection', () => {
    expect(resolveSearchLocale('ภาษาไทย', 'en-US')).toBe('en-US')
    expect(resolveSearchLocale('ภาษาไทย', 'not_a_locale')).toBe('th')
    expect(detectSearchLocale('한국어')).toBe('ko')
    expect(detectSearchLocale('日本語です')).toBe('ja')
    expect(detectSearchLocale('数据库')).toBe('zh')
    expect(detectSearchLocale('数据库', 'ja')).toBe('ja')
  })

  it('extracts protected identifiers before word segmentation', () => {
    const analyzed = createPortableSearchAnalyzer().analyzeText({
      text: 'See HTTPS://Example.com/a). mail Tést@Example.com SKU-42 v1.2.3 C++ C# Node.js @ผู้ใช้ #หัวข้อ',
    })

    expect(
      analyzed.identifierTokens.map(({ identifierKind, value }) => ({
        identifierKind,
        value,
      }))
    ).toEqual([
      { identifierKind: 'url', value: 'https://example.com/a' },
      { identifierKind: 'email', value: 'tést@example.com' },
      { identifierKind: 'sku', value: 'sku-42' },
      { identifierKind: 'version', value: 'v1.2.3' },
      { identifierKind: 'technical', value: 'c++' },
      { identifierKind: 'technical', value: 'c#' },
      { identifierKind: 'technical', value: 'node.js' },
      { identifierKind: 'mention', value: '@ผู้ใช้' },
      { identifierKind: 'hashtag', value: '#หัวข้อ' },
    ])
    expect(analyzed.exactTokens.map((token) => token.value)).toContain('see')
    expect(analyzed.exactTokens.map((token) => token.value)).toContain('mail')
  })

  it('emits ordered overlapping Han bigrams without replacing exact terms', () => {
    const analyzed = createPortableSearchAnalyzer().analyzeText({ text: '数据库' })

    expect(analyzed.exactTokens.map((token) => token.value).join('')).toBe('数据库')
    expect(analyzed.gramTokens.map((token) => token.value)).toEqual(['数据', '据库'])
    expect(analyzed.gramTokens.map((token) => token.position)).toEqual([0, 0])
  })

  it('groups exact and expanded variants by concept and retains quoted phrase intent', () => {
    const expander: SearchTokenExpander = {
      fingerprint: 'english-test1',
      supports: (locale) => locale.startsWith('en'),
      expand: (token) => (token.value === 'running' ? [{ kind: 'stem', value: 'run' }] : []),
    }
    const analyzer = createPortableSearchAnalyzer({ expanders: [expander] })
    const plan = analyzer.analyzeQuery({
      query: '"Running Fast" Node.js',
      locale: 'en',
      matching: { operator: 'any', minimumShouldMatch: 2 },
    })

    expect(plan.matching).toEqual({
      operator: 'any',
      phrase: 'auto',
      minimumShouldMatch: 2,
    })
    expect(plan.concepts).toHaveLength(3)
    expect(plan.concepts[0]?.exactTokens[0]?.value).toBe('running')
    expect(plan.concepts[0]?.stemTokens[0]?.value).toBe('run')
    expect(plan.concepts[2]?.identifierTokens[0]?.value).toBe('node.js')
    expect(plan.phrases).toEqual([{ conceptIndexes: [0, 1], explicit: true }])
    expect(plan.concepts[0]?.exactTokens[0]).toMatchObject({ start: 1, end: 8, position: 0 })
    expect(plan.concepts[2]?.identifierTokens[0]).toMatchObject({
      start: 15,
      end: 22,
      position: 2,
    })
    expect(plan.analyzerFingerprint).toContain('english-test1')
  })

  it('can require or disable phrase semantics explicitly', () => {
    const analyzer = createPortableSearchAnalyzer()

    expect(
      analyzer.analyzeQuery({
        query: 'forest restoration',
        matching: { phrase: 'required' },
      }).phrases
    ).toEqual([{ conceptIndexes: [0, 1], explicit: false }])
    expect(
      analyzer.analyzeQuery({
        query: '"forest restoration"',
        matching: { phrase: 'off' },
      }).phrases
    ).toEqual([])
  })

  it('fingerprints every option that can change indexed terms', () => {
    const baseline = createPortableSearchAnalyzer().fingerprint
    const locale = createPortableSearchAnalyzer({ defaultLocale: 'th' }).fingerprint
    const han = createPortableSearchAnalyzer({ hanLocale: 'ja' }).fingerprint
    const grams = createPortableSearchAnalyzer({ hanBigrams: false }).fingerprint

    expect(new Set([baseline, locale, han, grams]).size).toBe(4)
    expect(baseline).toContain(`icu${process.versions.icu}`)
  })
})

describe('matching policy', () => {
  it('applies conservative defaults', () => {
    expect(resolveMatching(undefined)).toEqual({ operator: 'all', phrase: 'auto' })
  })

  it('rejects invalid minimum-should-match policies', () => {
    expect(() => resolveMatching({ operator: 'any', minimumShouldMatch: 0 })).toThrow(RangeError)
    expect(() => resolveMatching({ operator: 'all', minimumShouldMatch: 1 })).toThrow(TypeError)
  })
})
