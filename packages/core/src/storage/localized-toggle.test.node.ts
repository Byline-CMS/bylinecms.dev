/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { conversionLocales, findLocalizationMismatches } from './localized-toggle.js'
import type { FieldSet } from '../@types/index.js'

const fields = [
  { name: 'title', label: 'Title', type: 'text', localized: true },
  { name: 'alt', label: 'Alt', type: 'text' },
  {
    name: 'items',
    label: 'Items',
    type: 'array',
    fields: [
      {
        name: 'meta',
        type: 'group',
        fields: [{ name: 'note', label: 'Note', type: 'text', localized: true }],
      },
    ],
  },
  {
    name: 'content',
    label: 'Content',
    type: 'blocks',
    blocks: [
      {
        blockType: 'photoBlock',
        fields: [{ name: 'caption', label: 'Caption', type: 'text', localized: true }],
      },
    ],
  },
] as FieldSet

describe('findLocalizationMismatches', () => {
  it('flags a locale row on a shared field', () => {
    expect(findLocalizationMismatches(fields, [{ field_path: 'alt', locale: 'fr' }])).toEqual([
      { field_path: 'alt', locale: 'fr', kind: 'locale-on-shared' },
    ])
  })

  it('flags an all row on a localized field', () => {
    expect(findLocalizationMismatches(fields, [{ field_path: 'title', locale: 'all' }])).toEqual([
      { field_path: 'title', locale: 'all', kind: 'shared-on-localized' },
    ])
  })

  it('elides array indexes and group nesting', () => {
    expect(
      findLocalizationMismatches(fields, [{ field_path: 'items.0.meta.note', locale: 'all' }])
    ).toEqual([{ field_path: 'items.0.meta.note', locale: 'all', kind: 'shared-on-localized' }])
  })

  it('resolves block-qualified paths', () => {
    expect(
      findLocalizationMismatches(fields, [
        { field_path: 'content.1.photoBlock.caption', locale: 'all' },
      ])
    ).toEqual([
      { field_path: 'content.1.photoBlock.caption', locale: 'all', kind: 'shared-on-localized' },
    ])
  })

  it('ignores matching, unknown, and reserved paths', () => {
    expect(
      findLocalizationMismatches(fields, [
        { field_path: 'title', locale: 'en' },
        { field_path: 'alt', locale: 'all' },
        { field_path: 'gone', locale: 'fr' },
        { field_path: 'path', locale: 'all' },
      ])
    ).toEqual([])
  })
})

describe('conversionLocales', () => {
  it('puts the source first and dedupes, dropping all', () => {
    expect(conversionLocales(['all', 'fr', 'en', 'fr'], 'en')).toEqual(['en', 'fr'])
  })

  it('returns only the source for no locales', () => {
    expect(conversionLocales([], 'en')).toEqual(['en'])
  })
})
