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

  it('folds accented Latin to ASCII', () => {
    expect(formatTextValue('café')).toBe('cafe')
    expect(formatTextValue('Zürich')).toBe('zurich')
    expect(formatTextValue('São Paulo')).toBe('sao-paulo')
    expect(formatTextValue('naïve')).toBe('naive')
    // Decomposed input: 'cafe' + combining acute (U+0301)
    expect(formatTextValue('café')).toBe('cafe')
  })

  it('preserves Thai including tone marks', () => {
    expect(formatTextValue('สวัสดี ครับ')).toBe('สวัสดี-ครับ')
    expect(formatTextValue('ก้าวไกล')).toBe('ก้าวไกล')
  })

  it('preserves CJK, Kana, and Hangul', () => {
    expect(formatTextValue('你好 世界')).toBe('你好-世界')
    expect(formatTextValue('こんにちは')).toBe('こんにちは')
    expect(formatTextValue('안녕하세요')).toBe('안녕하세요')
  })

  it('preserves Cyrillic and Arabic', () => {
    expect(formatTextValue('Привет мир')).toBe('привет-мир')
    expect(formatTextValue('مرحبا بالعالم')).toBe('مرحبا-بالعالم')
  })

  it('preserves Greek tonos (non-Latin diacritics are not folded)', () => {
    expect(formatTextValue('Καλημέρα')).toBe('καλημέρα')
  })

  it('preserves Devanagari matras (non-Latin combining marks)', () => {
    expect(formatTextValue('हिन्दी')).toBe('हिन्दी')
  })

  it('handles mixed-script input', () => {
    expect(formatTextValue('Hello 世界 café')).toBe('hello-世界-cafe')
  })

  it('converts underscores to hyphens', () => {
    expect(formatTextValue('foo_bar')).toBe('foo-bar')
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
