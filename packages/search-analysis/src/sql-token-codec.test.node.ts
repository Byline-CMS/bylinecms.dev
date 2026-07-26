/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { encodeSqlToken } from './sql-token-codec.js'
import type { LogicalTokenKind } from './types.js'

describe('SQL token codec', () => {
  it.each([
    ['exact', 'a'],
    ['exact', 'ฐานข้อมูล'],
    ['gram', '数据'],
    ['identifier', 'https://example.com/a'],
  ] satisfies Array<[LogicalTokenKind, string]>)(
    'encodes a %s token as parser-safe lowercase ASCII',
    (kind, value) => {
      const encoded = encodeSqlToken({ kind, value })

      expect(encoded).toMatch(/^[a-z0-9]+$/)
      expect(encoded.length).toBeGreaterThan(3)
    }
  )

  it('keeps logical token classes physically distinct', () => {
    const exact = encodeSqlToken({ kind: 'exact', value: 'database' })
    const stem = encodeSqlToken({ kind: 'stem', value: 'database' })
    const gram = encodeSqlToken({ kind: 'gram', value: 'database' })

    expect(new Set([exact, stem, gram]).size).toBe(3)
  })

  it('hashes long terms deterministically within the configured bound', () => {
    const token = { kind: 'identifier' as const, value: `https://example.com/${'x'.repeat(500)}` }
    const first = encodeSqlToken(token, { maxLength: 32 })

    expect(first).toHaveLength(32)
    expect(encodeSqlToken(token, { maxLength: 32 })).toBe(first)
    expect(encodeSqlToken({ ...token, value: `${token.value}y` }, { maxLength: 32 })).not.toBe(
      first
    )
  })

  it('rejects empty values and unsafe length limits', () => {
    expect(() => encodeSqlToken({ kind: 'exact', value: '' })).toThrow(TypeError)
    expect(() => encodeSqlToken({ kind: 'exact', value: 'term' }, { maxLength: 15 })).toThrow(
      RangeError
    )
  })
})
