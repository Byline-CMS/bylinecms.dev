/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { normalizeRow } from './normalize-row.js'

describe('normalizeRow (mysql)', () => {
  it('coerces boolean_value from a driver TINYINT(1) number to boolean', () => {
    expect(normalizeRow({ boolean_value: 1 }).boolean_value).toBe(true)
    expect(normalizeRow({ boolean_value: 0 }).boolean_value).toBe(false)
  })

  it('coerces thumbnail_generated and cascade_delete the same way', () => {
    const row = normalizeRow({ thumbnail_generated: 1, cascade_delete: 0 })
    expect(row.thumbnail_generated).toBe(true)
    expect(row.cascade_delete).toBe(false)
  })

  it('passes through null for absent tinyint(1) columns (only one value column is populated per row)', () => {
    const row = normalizeRow({
      boolean_value: null,
      thumbnail_generated: null,
      cascade_delete: null,
    })
    expect(row.boolean_value).toBeNull()
    expect(row.thumbnail_generated).toBeNull()
    expect(row.cascade_delete).toBeNull()
  })

  it('tolerates a value already coerced to a real boolean', () => {
    expect(normalizeRow({ boolean_value: true }).boolean_value).toBe(true)
    expect(normalizeRow({ boolean_value: false }).boolean_value).toBe(false)
  })

  it('leaves a DECIMAL string untouched (decimalNumbers: false at the pool)', () => {
    const row = normalizeRow({ value_decimal: '299.99' })
    expect(row.value_decimal).toBe('299.99')
    expect(typeof row.value_decimal).toBe('string')
  })

  it('leaves an already-parsed JSON value untouched (the driver parses JSON columns itself)', () => {
    const value = { a: 1, b: [1, 2, 3] }
    const row = normalizeRow({ json_value: value })
    expect(row.json_value).toBe(value)
  })

  it('leaves a DATETIME(3) Date instance untouched', () => {
    const date = new Date('2024-01-15T10:30:00.123Z')
    const row = normalizeRow({ value_timestamp_tz: date })
    expect(row.value_timestamp_tz).toBe(date)
  })

  it('passes through every other column unchanged', () => {
    const row = normalizeRow({
      field_path: 'title',
      field_name: 'title',
      locale: 'en',
      text_value: 'hello',
    })
    expect(row).toMatchObject({
      field_path: 'title',
      field_name: 'title',
      locale: 'en',
      text_value: 'hello',
    })
  })
})
