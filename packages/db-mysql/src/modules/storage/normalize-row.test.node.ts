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

  it('leaves an already-Date value_timestamp_tz untouched (defensive — not expected on the live driver path)', () => {
    const date = new Date('2024-01-15T10:30:00.123Z')
    const row = normalizeRow({ value_timestamp_tz: date })
    expect(row.value_timestamp_tz).toBe(date)
  })

  it('coerces value_timestamp_tz from the driver DATETIME string to a real Date', () => {
    // The shape drizzle-orm's mysql2 driver actually hands back on the raw
    // `db.execute()` path (its own typeCast forces DATETIME to a string) —
    // confirmed live against `packages/db-mysql/scripts` probes for the
    // Task 11 report. Space-separated, no timezone marker (UTC by schema
    // convention).
    const row = normalizeRow({ value_timestamp_tz: '2026-01-15 10:30:00.123456' })
    expect(row.value_timestamp_tz).toBeInstanceOf(Date)
    expect((row.value_timestamp_tz as Date).toISOString()).toBe('2026-01-15T10:30:00.123Z')
  })

  it('passes through null for an absent value_timestamp_tz column', () => {
    expect(normalizeRow({ value_timestamp_tz: null }).value_timestamp_tz).toBeNull()
  })

  it('coerces value_date from the driver DATE string to a UTC-midnight Date', () => {
    const row = normalizeRow({ value_date: '2026-01-15' })
    expect(row.value_date).toBeInstanceOf(Date)
    expect((row.value_date as Date).toISOString()).toBe('2026-01-15T00:00:00.000Z')
  })

  it('leaves an already-Date value_date untouched (defensive)', () => {
    const date = new Date('2026-01-15T00:00:00.000Z')
    const row = normalizeRow({ value_date: date })
    expect(row.value_date).toBe(date)
  })

  it('passes through null for an absent value_date column', () => {
    expect(normalizeRow({ value_date: null }).value_date).toBeNull()
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
