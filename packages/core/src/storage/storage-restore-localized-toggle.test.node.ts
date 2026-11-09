/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { restoreFieldSetData } from './storage-restore.js'
import type { FieldSet } from '../@types/index.js'
import type { FlattenedFieldValue } from './storage-row-types.js'

// Spec 4.1, 4.2, 4.2a and conformance case 11 (specs/2026-11-09-localized-toggle-spec.md).

const text = (path: string, locale: string, value: string): FlattenedFieldValue => ({
  field_path: path.split('.'),
  locale,
  field_type: 'text',
  value,
})

// `alt` is now localized; `title` is now shared.
const fields: FieldSet = [
  { name: 'alt', type: 'text', localized: true, optional: true },
  { name: 'title', type: 'text', optional: true },
]

describe('restore of a now-localized field (4.1)', () => {
  it('uses the shared row on a single-locale read when no locale row exists', () => {
    const result = restoreFieldSetData(fields, [text('alt', 'all', 'X')], 'fr')
    expect(result.data.alt).toBe('X')
    expect(result.warnings).toEqual([])
  })

  it('prefers the locale row over the shared row in either row order', () => {
    for (const rows of [
      [text('alt', 'all', 'X'), text('alt', 'fr', 'Y')],
      [text('alt', 'fr', 'Y'), text('alt', 'all', 'X')],
    ]) {
      const result = restoreFieldSetData(fields, rows, 'fr')
      expect(result.data.alt).toBe('Y')
      expect(result.warnings).toEqual([])
    }
  })

  it('fills the shared value under each conversion locale without a locale row on a map read', () => {
    for (const rows of [
      [text('alt', 'all', 'X'), text('alt', 'fr', 'Y')],
      [text('alt', 'fr', 'Y'), text('alt', 'all', 'X')],
    ]) {
      const result = restoreFieldSetData(fields, rows, undefined, undefined, {
        conversionLocales: ['en', 'fr'],
      })
      expect(result.data.alt).toEqual({ en: 'X', fr: 'Y' })
      expect(result.warnings).toEqual([])
    }
  })

  it('limits the shared value to the conversion set on a map read', () => {
    const result = restoreFieldSetData(fields, [text('alt', 'all', 'X')], undefined, undefined, {
      conversionLocales: ['en'],
    })
    expect(result.data.alt).toEqual({ en: 'X' })
    expect(result.warnings).toEqual([])
  })
})

describe('restore of a now-shared field (4.2)', () => {
  it('uses the source-locale row and ignores other locale rows', () => {
    for (const rows of [
      [text('title', 'en', 'E'), text('title', 'fr', 'F')],
      [text('title', 'fr', 'F'), text('title', 'en', 'E')],
    ]) {
      const single = restoreFieldSetData(fields, rows, 'fr', undefined, { sourceLocale: 'en' })
      expect(single.data.title).toBe('E')
      expect(single.warnings).toEqual([])
      const map = restoreFieldSetData(fields, rows, undefined, undefined, {
        sourceLocale: 'en',
        conversionLocales: ['en', 'fr'],
      })
      expect(map.data.title).toBe('E')
      expect(map.warnings).toEqual([])
    }
  })

  it('prefers the shared row over locale rows in either row order', () => {
    for (const rows of [
      [text('title', 'all', 'S'), text('title', 'en', 'E')],
      [text('title', 'en', 'E'), text('title', 'all', 'S')],
    ]) {
      const result = restoreFieldSetData(fields, rows, 'en', undefined, { sourceLocale: 'en' })
      expect(result.data.title).toBe('S')
      expect(result.warnings).toEqual([])
    }
  })

  it('reads the field as absent when there is no source-locale row', () => {
    const result = restoreFieldSetData(fields, [text('title', 'fr', 'F')], 'fr', undefined, {
      sourceLocale: 'en',
    })
    expect(result.data.title).toBeUndefined()
    expect(result.warnings).toEqual([])
  })
})

describe('withheld localized values (4.2a)', () => {
  it('withholds a now-localized shared row and keeps the now-shared source value', () => {
    const rows = [text('alt', 'all', 'X'), text('title', 'fr', 'F'), text('title', 'en', 'E')]
    const result = restoreFieldSetData(fields, rows, 'fr', undefined, {
      sourceLocale: 'en',
      withholdLocalized: true,
    })
    expect(result.data.alt).toBeUndefined()
    expect(result.data.title).toBe('E')
    expect(result.warnings).toEqual([])
  })
})

describe('toggled JSON and numeric values', () => {
  const richText = { root: { children: [{ type: 'paragraph', text: 'hello' }] } }
  const json = (path: string, locale: string): FlattenedFieldValue => ({
    field_path: [path],
    locale,
    field_type: 'json',
    value: richText,
  })
  const number = (path: string, locale: string, value: number): FlattenedFieldValue => ({
    field_path: [path],
    locale,
    field_type: 'numeric',
    number_type: 'integer',
    value_integer: value,
  })

  // Number fields are not localizable (`NonlocalizableField`), so only a
  // richText field can make the non-localized-to-localized toggle.
  it('returns the stored value unchanged when the field became localized', () => {
    const now: FieldSet = [{ name: 'body', type: 'richText', localized: true }]
    const single = restoreFieldSetData(now, [json('body', 'all')], 'fr', undefined, {
      sourceLocale: 'en',
    })
    expect(single.data.body).toEqual(richText)
    expect(single.warnings).toEqual([])
    const map = restoreFieldSetData(now, [json('body', 'all')], undefined, undefined, {
      conversionLocales: ['en', 'fr'],
    })
    expect(map.data.body).toEqual({ en: richText, fr: richText })
    expect(map.warnings).toEqual([])
  })

  it('returns the source-locale value unchanged when the field became shared', () => {
    const now: FieldSet = [
      { name: 'body', type: 'richText' },
      { name: 'count', type: 'integer' },
    ]
    const rows = [number('count', 'fr', 9), json('body', 'en'), number('count', 'en', 7)]
    const result = restoreFieldSetData(now, rows, 'fr', undefined, { sourceLocale: 'en' })
    expect(result.data.body).toEqual(richText)
    expect(result.data.count).toBe(7)
    expect(result.warnings).toEqual([])
  })
})

describe('nested toggled fields', () => {
  const nested: FieldSet = [
    {
      name: 'items',
      type: 'array',
      fields: [
        { name: 'caption', type: 'text', localized: true, optional: true },
        { name: 'label', type: 'text', optional: true },
      ],
    },
  ]

  it('applies both conversions inside an array item independently of row order', () => {
    const rows = [
      text('items.0.caption', 'fr', 'Y'),
      text('items.0.caption', 'all', 'X'),
      text('items.1.caption', 'all', 'X1'),
      text('items.0.label', 'fr', 'F'),
      text('items.0.label', 'en', 'E'),
    ]
    for (const ordered of [rows, [...rows].reverse()]) {
      const result = restoreFieldSetData(nested, ordered, 'fr', undefined, { sourceLocale: 'en' })
      expect(result.data.items).toEqual([{ caption: 'Y', label: 'E' }, { caption: 'X1' }])
      expect(result.warnings).toEqual([])
    }
  })
})

describe('strict reconstruction damage still warns (case 11)', () => {
  const damaged: FieldSet = [
    {
      name: 'items',
      type: 'array',
      fields: [{ name: 'caption', type: 'text', localized: true }],
    },
    {
      name: 'seo',
      type: 'group',
      fields: [{ name: 'description', type: 'text' }],
    },
  ]

  it('warns on an invalid array index', () => {
    const result = restoreFieldSetData(
      damaged,
      [text('items.undefined.caption', 'en', 'x')],
      'en',
      undefined,
      { sourceLocale: 'en' }
    )
    expect(result.warnings).toEqual([
      "Invalid array index 'undefined' in path items.undefined.caption",
    ])
  })

  it('warns on a truncated group path', () => {
    const result = restoreFieldSetData(damaged, [text('seo', 'all', 'x')], 'en', undefined, {
      sourceLocale: 'en',
    })
    expect(result.warnings).toEqual(['Path ended unexpectedly while restoring group: seo'])
  })
})
