/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Fractional-index keys for stable, drag-and-drop reordering without a
 * rebalancing pass. Keys are base-62 strings that sort lexicographically;
 * `generateKeyBetween(a, b)` produces a new key strictly between two
 * neighbors (or before/after a single neighbor when the other is null).
 *
 * Implementation follows David Greenspan's algorithm
 * (https://observablehq.com/@dgreensp/implementing-fractional-indexing).
 * Each key has two parts: a head character that encodes the integer-part
 * length, followed by the integer digits and an optional base-62 fraction.
 * Heads 'A'..'Z' carry positive integer-part lengths 2..27; heads 'a'..'z'
 * carry negative integer-part lengths 2..27. This allows unbounded
 * prepend/append without ever needing a rebalance.
 *
 * Used by `orderable: true` collections to drive the
 * `byline_documents.order_key` column.
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

const SMALLEST_INTEGER = 'A00000000000000000000000000'
const INTEGER_ZERO = 'a0'

function getIntegerLength(head: string | undefined): number {
  if (head === undefined) throw new Error('invalid order_key head: empty')
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2
  throw new Error(`invalid order_key head: ${head}`)
}

function getIntegerPart(key: string): string {
  const len = getIntegerLength(key[0])
  if (len > key.length) throw new Error(`invalid order_key (truncated integer): ${key}`)
  return key.slice(0, len)
}

function validateInteger(int: string): void {
  if (int.length !== getIntegerLength(int[0])) {
    throw new Error(`invalid order_key integer part: ${int}`)
  }
}

function charAt(s: string, i: number): string {
  const c = s[i]
  if (c === undefined) throw new Error(`order_key out-of-bounds at ${i}: ${s}`)
  return c
}

/**
 * Validate a complete order_key — head + integer + optional fraction.
 * Returns true if the key is well-formed; false otherwise. Does not throw.
 */
export function validateOrderKey(key: string): boolean {
  if (typeof key !== 'string' || key.length === 0) return false
  try {
    const int = getIntegerPart(key)
    validateInteger(int)
    // Every char must be in the alphabet (integer digits + fraction).
    for (let i = 1; i < key.length; i++) {
      if (ALPHABET.indexOf(charAt(key, i)) === -1) return false
    }
    // No trailing zero in the fraction part — keeps representations unique.
    if (key.length > int.length && charAt(key, key.length - 1) === '0') return false
    return true
  } catch {
    return false
  }
}

function incrementInteger(x: string): string | null {
  validateInteger(x)
  const head = charAt(x, 0)
  const digs = x.slice(1).split('')
  let carry = true
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = ALPHABET.indexOf(digs[i]!) + 1
    if (d === ALPHABET.length) {
      digs[i] = '0'
    } else {
      digs[i] = charAt(ALPHABET, d)
      carry = false
    }
  }
  if (carry) {
    if (head === 'Z') {
      return `a${charAt(ALPHABET, 0)}`
    }
    if (head === 'z') return null
    const headCode = head.charCodeAt(0) + 1
    const newHead = String.fromCharCode(headCode)
    if (newHead > 'a') {
      digs.push('0')
    } else {
      digs.pop()
    }
    return newHead + digs.join('')
  }
  return head + digs.join('')
}

function decrementInteger(x: string): string | null {
  validateInteger(x)
  const head = charAt(x, 0)
  const digs = x.slice(1).split('')
  const lastAlpha = charAt(ALPHABET, ALPHABET.length - 1)
  let borrow = true
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = ALPHABET.indexOf(digs[i]!) - 1
    if (d === -1) {
      digs[i] = lastAlpha
    } else {
      digs[i] = charAt(ALPHABET, d)
      borrow = false
    }
  }
  if (borrow) {
    if (head === 'a') {
      return `Z${lastAlpha}`
    }
    if (head === 'A') return null
    const headCode = head.charCodeAt(0) - 1
    const newHead = String.fromCharCode(headCode)
    if (newHead < 'a') {
      digs.push(lastAlpha)
    } else {
      digs.pop()
    }
    return newHead + digs.join('')
  }
  return head + digs.join('')
}

/**
 * Find the "midpoint" fraction strictly between two fraction strings (a, b).
 * Both inputs are the fraction portion only (everything after the integer
 * part), and must not have a trailing '0'. Either can be empty / null.
 */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) {
    throw new Error(`midpoint: a >= b (${a}, ${b})`)
  }
  if (a.slice(-1) === '0' || (b && b.slice(-1) === '0')) {
    throw new Error('midpoint: trailing zero')
  }
  if (b !== null) {
    let n = 0
    while ((a[n] ?? '0') === b[n]) n++
    if (n > 0) {
      return b.slice(0, n) + midpoint(a.slice(n), b.slice(n))
    }
  }
  const digitA = a ? ALPHABET.indexOf(charAt(a, 0)) : 0
  const digitB = b !== null && b.length > 0 ? ALPHABET.indexOf(charAt(b, 0)) : ALPHABET.length
  if (digitB - digitA > 1) {
    const midDigit = Math.round(0.5 * (digitA + digitB))
    return charAt(ALPHABET, midDigit)
  }
  if (b !== null && b.length > 1) {
    return b.slice(0, 1)
  }
  return charAt(ALPHABET, digitA) + midpoint(a.slice(1), null)
}

/**
 * Generate an order_key strictly between `a` and `b`.
 *
 * - `(null, null)` returns a midpoint near zero
 * - `(a, null)` returns a key greater than `a`
 * - `(null, b)` returns a key less than `b`
 * - `(a, b)` returns a key strictly between (requires `a < b`)
 *
 * Throws if `a >= b`, if either key is malformed, or if the integer
 * head is already at its extreme bound (effectively never under normal
 * use — would require ~10^40 unbounded prepends or appends).
 */
export function generateKeyBetween(a: string | null, b: string | null): string {
  if (a !== null && !validateOrderKey(a)) {
    throw new Error(`generateKeyBetween: invalid 'a' (${a})`)
  }
  if (b !== null && !validateOrderKey(b)) {
    throw new Error(`generateKeyBetween: invalid 'b' (${b})`)
  }
  if (a !== null && b !== null && a >= b) {
    throw new Error(`generateKeyBetween: a >= b (${a} >= ${b})`)
  }

  if (a === null) {
    if (b === null) return INTEGER_ZERO
    const ib = getIntegerPart(b)
    const fb = b.slice(ib.length)
    if (ib === SMALLEST_INTEGER) {
      return ib + midpoint('', fb)
    }
    if (ib < b) return ib
    const res = decrementInteger(ib)
    if (res === null) {
      throw new Error('generateKeyBetween: cannot decrement past lower bound')
    }
    return res
  }

  if (b === null) {
    const ia = getIntegerPart(a)
    const fa = a.slice(ia.length)
    const i = incrementInteger(ia)
    return i === null ? ia + midpoint(fa, null) : i
  }

  const ia = getIntegerPart(a)
  const fa = a.slice(ia.length)
  const ib = getIntegerPart(b)
  const fb = b.slice(ib.length)
  if (ia === ib) {
    return ia + midpoint(fa, fb)
  }
  const i = incrementInteger(ia)
  if (i === null) {
    throw new Error('generateKeyBetween: cannot increment past upper bound')
  }
  if (i < b) return i
  return ia + midpoint(fa, null)
}

/**
 * Generate `n` order_keys strictly between `a` and `b`, in ascending order.
 * Used when inserting a contiguous run of rows (bulk import, multi-select drop).
 */
export function generateNKeysBetween(a: string | null, b: string | null, n: number): string[] {
  if (n === 0) return []
  if (n === 1) return [generateKeyBetween(a, b)]
  if (b === null) {
    let c = generateKeyBetween(a, b)
    const result = [c]
    for (let i = 0; i < n - 1; i++) {
      c = generateKeyBetween(c, b)
      result.push(c)
    }
    return result
  }
  if (a === null) {
    let c = generateKeyBetween(a, b)
    const result = [c]
    for (let i = 0; i < n - 1; i++) {
      c = generateKeyBetween(a, c)
      result.push(c)
    }
    result.reverse()
    return result
  }
  const mid = Math.floor(n / 2)
  const c = generateKeyBetween(a, b)
  return [...generateNKeysBetween(a, c, mid), c, ...generateNKeysBetween(c, b, n - mid - 1)]
}
