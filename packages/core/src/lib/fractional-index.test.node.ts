/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { generateKeyBetween, generateNKeysBetween, validateOrderKey } from './fractional-index.js'

describe('fractional-index', () => {
  describe('generateKeyBetween — bounded cases', () => {
    it('returns the canonical zero key for (null, null)', () => {
      const k = generateKeyBetween(null, null)
      expect(k).toBe('a0')
      expect(validateOrderKey(k)).toBe(true)
    })

    it('produces a key strictly greater than `a` for (a, null)', () => {
      const a = generateKeyBetween(null, null)
      const b = generateKeyBetween(a, null)
      expect(b > a).toBe(true)
      expect(validateOrderKey(b)).toBe(true)
    })

    it('produces a key strictly less than `b` for (null, b)', () => {
      const b = generateKeyBetween(null, null)
      const a = generateKeyBetween(null, b)
      expect(a < b).toBe(true)
      expect(validateOrderKey(a)).toBe(true)
    })

    it('produces a key strictly between `a` and `b`', () => {
      const a = generateKeyBetween(null, null)
      const c = generateKeyBetween(a, null)
      const mid = generateKeyBetween(a, c)
      expect(a < mid).toBe(true)
      expect(mid < c).toBe(true)
      expect(validateOrderKey(mid)).toBe(true)
    })

    it('keeps splitting the same gap arbitrarily deep', () => {
      const lo = generateKeyBetween(null, null)
      let hi = generateKeyBetween(lo, null)
      // 200 in-the-middle inserts into the same gap.
      for (let i = 0; i < 200; i++) {
        const mid = generateKeyBetween(lo, hi)
        expect(lo < mid).toBe(true)
        expect(mid < hi).toBe(true)
        hi = mid
      }
    })
  })

  describe('generateKeyBetween — error cases', () => {
    it('throws when a >= b', () => {
      const a = generateKeyBetween(null, null)
      const b = generateKeyBetween(a, null)
      expect(() => generateKeyBetween(b, a)).toThrow()
      expect(() => generateKeyBetween(a, a)).toThrow()
    })

    it('throws when given a malformed key', () => {
      expect(() => generateKeyBetween('not-a-real-key!!!', null)).toThrow()
      expect(() => generateKeyBetween(null, '?')).toThrow()
    })
  })

  describe('generateNKeysBetween', () => {
    it('returns an empty array for n=0', () => {
      expect(generateNKeysBetween(null, null, 0)).toEqual([])
    })

    it('returns one key for n=1', () => {
      const keys = generateNKeysBetween(null, null, 1)
      expect(keys.length).toBe(1)
      expect(validateOrderKey(keys[0]!)).toBe(true)
    })

    it('returns n strictly ascending keys (open interval)', () => {
      const keys = generateNKeysBetween(null, null, 10)
      expect(keys.length).toBe(10)
      for (let i = 1; i < keys.length; i++) {
        expect(keys[i - 1]! < keys[i]!).toBe(true)
        expect(validateOrderKey(keys[i]!)).toBe(true)
      }
    })

    it('returns n strictly ascending keys between two neighbors', () => {
      const a = generateKeyBetween(null, null)
      const b = generateKeyBetween(a, null)
      const keys = generateNKeysBetween(a, b, 20)
      expect(keys.length).toBe(20)
      expect(a < keys[0]!).toBe(true)
      expect(keys[keys.length - 1]! < b).toBe(true)
      for (let i = 1; i < keys.length; i++) {
        expect(keys[i - 1]! < keys[i]!).toBe(true)
      }
    })
  })

  describe('validateOrderKey', () => {
    it('accepts well-formed keys', () => {
      expect(validateOrderKey('a0')).toBe(true)
      expect(validateOrderKey(generateKeyBetween(null, null))).toBe(true)
    })

    it('rejects empty / non-string / malformed input', () => {
      expect(validateOrderKey('')).toBe(false)
      expect(validateOrderKey(null as unknown as string)).toBe(false)
      expect(validateOrderKey(undefined as unknown as string)).toBe(false)
      expect(validateOrderKey('!')).toBe(false)
      // Trailing zero in fraction part is forbidden (non-canonical).
      expect(validateOrderKey('a00')).toBe(false)
    })
  })

  describe('fuzz — random insert / prepend / append mix', () => {
    it('maintains a globally sorted list after 1000 random operations', () => {
      const list: string[] = [generateKeyBetween(null, null)]
      for (let i = 0; i < 1000; i++) {
        const op = Math.floor(Math.random() * 3)
        if (op === 0) {
          const k = generateKeyBetween(null, list[0]!)
          list.unshift(k)
        } else if (op === 1) {
          const k = generateKeyBetween(list[list.length - 1]!, null)
          list.push(k)
        } else {
          if (list.length < 2) continue
          const idx = Math.floor(Math.random() * (list.length - 1))
          const k = generateKeyBetween(list[idx]!, list[idx + 1]!)
          list.splice(idx + 1, 0, k)
        }
      }
      for (let i = 1; i < list.length; i++) {
        expect(list[i - 1]! < list[i]!).toBe(true)
      }
    })
  })
})
