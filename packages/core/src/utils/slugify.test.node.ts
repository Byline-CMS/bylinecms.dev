/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { formatTextValue, looksLikeISODate, slugify } from './slugify.js'

const ctx = { locale: 'en', collectionPath: 'pages' }

describe('formatTextValue', () => {
  it('lowercases and replaces whitespace with hyphens', () => {
    expect(formatTextValue('My Great Post')).toBe('my-great-post')
  })

  it('strips HTML tags', () => {
    expect(formatTextValue('<p>Hello <em>World</em></p>')).toBe('hello-world')
  })

  it('preserves Thai script (U+0E00–U+0E7F)', () => {
    expect(formatTextValue('สวัสดี ครับ')).toBe('สวัสดี-ครับ')
  })

  it('strips accented Latin characters (current behaviour: only ASCII word chars + Thai survive)', () => {
    // NFC normalisation runs first, but the final character class permits
    // only \w + Thai + '-', so accented characters fall away. If multilingual
    // slugs ever need to retain these, broaden the character class.
    const decomposed = 'cafe' + '́'
    expect(formatTextValue(decomposed)).toBe('caf')
  })

  it('collapses runs of separators into a single hyphen', () => {
    expect(formatTextValue('a   b---c   d')).toBe('a-b-c-d')
  })

  it('trims leading and trailing hyphens', () => {
    expect(formatTextValue('  hello  ')).toBe('hello')
    expect(formatTextValue('---hi---')).toBe('hi')
  })

  it('returns empty string for non-string input', () => {
    // @ts-expect-error — testing runtime safety
    expect(formatTextValue(null)).toBe('')
    // @ts-expect-error
    expect(formatTextValue(undefined)).toBe('')
  })
})

describe('looksLikeISODate', () => {
  it('recognises a yyyy-mm-dd prefix', () => {
    expect(looksLikeISODate('2026-04-22')).toBe(true)
    expect(looksLikeISODate('2026-04-22T12:00:00Z')).toBe(true)
  })

  it('rejects non-ISO strings', () => {
    expect(looksLikeISODate('hello')).toBe(false)
    expect(looksLikeISODate('22/04/2026')).toBe(false)
  })
})

describe('slugify (default SlugifierFn)', () => {
  it('returns the date prefix for ISO datetime values', () => {
    expect(slugify('2026-04-22T12:00:00Z', ctx)).toBe('2026-04-22')
  })

  it('slugifies plain text', () => {
    expect(slugify('Hello, World!', ctx)).toBe('hello-world')
  })

  it('returns empty string for empty input', () => {
    expect(slugify('', ctx)).toBe('')
  })
})
