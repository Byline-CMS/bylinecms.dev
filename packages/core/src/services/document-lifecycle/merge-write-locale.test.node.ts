/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { mergeWriteLocale } from './merge-write-locale.js'
import type { FieldSet } from '../../@types/index.js'

describe('mergeWriteLocale item identity', () => {
  const fields: FieldSet = [
    {
      name: 'items',
      type: 'array',
      fields: [{ name: 'caption', type: 'text', localized: true }],
    },
  ]
  const previous = {
    items: [
      { _id: 'a', caption: { en: 'A', fr: 'A-fr' } },
      { _id: 'b', caption: { en: 'B', fr: 'B-fr' } },
    ],
  }

  it('does not give a new ID-less item the translations of a surviving identified item', () => {
    const result = mergeWriteLocale(
      fields,
      previous,
      { items: [{ caption: 'New' }, { _id: 'a', caption: 'A' }, { _id: 'b', caption: 'B' }] },
      'en'
    )
    expect(result.items.map((item: any) => item.caption)).toEqual([
      { en: 'New' },
      { en: 'A', fr: 'A-fr' },
      { en: 'B', fr: 'B-fr' },
    ])
  })

  it('keeps positional compatibility when all submitted item IDs are absent', () => {
    const result = mergeWriteLocale(fields, previous, { items: [{ caption: 'Edited' }] }, 'en')
    expect(result.items).toEqual([{ caption: { en: 'Edited', fr: 'A-fr' } }])
  })
})
