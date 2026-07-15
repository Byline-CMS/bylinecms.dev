/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { BylineError, ErrorCodes } from '../lib/errors.js'
import { normalizeNumericFields, normalizeNumericValue } from './normalize-numeric-fields.js'
import type { FieldSet } from '../@types/index.js'

const fields: FieldSet = [
  { name: 'count', type: 'integer' },
  { name: 'ratio', type: 'float' },
  { name: 'price', type: 'decimal' },
  { name: 'sequence', type: 'counter', group: 'test' },
  {
    name: 'settings',
    type: 'group',
    fields: [{ name: 'threshold', type: 'float' }],
  },
  {
    name: 'rows',
    type: 'array',
    fields: [{ name: 'quantity', type: 'integer' }],
  },
  {
    name: 'content',
    type: 'blocks',
    blocks: [
      {
        blockType: 'amount',
        fields: [{ name: 'value', type: 'decimal' }],
      },
    ],
  },
]

describe('normalizeNumericFields', () => {
  it('normalizes numeric leaves through groups, arrays, and blocks while leaving counters alone', () => {
    const data = {
      count: '12',
      ratio: ' 1.25e2 ',
      price: ' 001.2300 ',
      sequence: 'caller-owned-value',
      settings: { threshold: 2 },
      rows: [{ quantity: '3.0' }, { quantity: 4 }],
      content: [{ _type: 'amount', value: 5.5 }],
    }

    normalizeNumericFields(fields, data)

    expect(data).toEqual({
      count: 12,
      ratio: 125,
      price: '001.2300',
      sequence: 'caller-owned-value',
      settings: { threshold: 2 },
      rows: [{ quantity: 3 }, { quantity: 4 }],
      content: [{ _type: 'amount', value: '5.5' }],
    })

    normalizeNumericFields(fields, data)
    expect(data.price).toBe('001.2300')
  })

  it('removes empty and whitespace-only values', () => {
    const data: Record<string, unknown> = { count: '', ratio: '   ', price: '\t' }

    normalizeNumericFields(fields, data)

    expect(data).toEqual({})
  })

  it('normalizes all-locale value maps and reports the locale-qualified path', () => {
    const localizedFields = [
      { name: 'amount', type: 'decimal', localized: true },
    ] as unknown as FieldSet
    const data = { amount: { en: ' 1.20 ', fr: 'not-a-number', de: '' } }

    expect(() => normalizeNumericFields(localizedFields, data)).toThrowError(
      expect.objectContaining({
        code: ErrorCodes.VALIDATION,
        details: expect.objectContaining({ path: 'amount.fr' }),
      })
    )
    expect(data.amount.en).toBe('1.20')
  })

  it.each([
    ['integer', '1.2'],
    ['integer', Number.NaN],
    ['float', Number.POSITIVE_INFINITY],
    ['float', '1e'],
    ['decimal', '--1'],
  ] as const)('rejects invalid %s input', (fieldType, value) => {
    expect(() => normalizeNumericValue(fieldType, value, 'nested.2.value')).toThrowError(
      expect.objectContaining({
        code: ErrorCodes.VALIDATION,
        details: expect.objectContaining({ path: 'nested.2.value' }),
      })
    )
  })

  it('throws a BylineError with ERR_VALIDATION', () => {
    try {
      normalizeNumericValue('integer', {}, 'count')
      expect.fail('expected ERR_VALIDATION')
    } catch (error) {
      expect(error).toBeInstanceOf(BylineError)
      expect(error).toMatchObject({ code: ErrorCodes.VALIDATION })
    }
  })
})
