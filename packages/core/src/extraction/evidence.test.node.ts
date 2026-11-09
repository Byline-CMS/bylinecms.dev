/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { isSourceVerificationEvidence } from './evidence.js'

const HASH = 'a'.repeat(64)

/** The record a downstream library wrote before `size` and `readBasis` existed. */
function legacyRecord(): Record<string, unknown> {
  return {
    expectedHash: HASH,
    contentHash: HASH,
    validator: { kind: 's3-etag', value: '"abc"' },
    verifiedAt: '2026-10-31T06:00:00.000Z',
  }
}

describe('isSourceVerificationEvidence', () => {
  describe('rule 1: plain objects', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['an array', []],
      ['a string', 'evidence'],
      ['a class instance', new (class Evidence {})()],
    ])('rejects %s', (_label, value) => {
      expect(isSourceVerificationEvidence(value)).toBe(false)
    })

    it('ignores unknown extra members, so a later minor can add some', () => {
      expect(isSourceVerificationEvidence({ ...legacyRecord(), futureMember: 1 })).toBe(true)
    })
  })

  describe('rule 2: hashes', () => {
    it('accepts an existing record unchanged', () => {
      expect(isSourceVerificationEvidence(legacyRecord())).toBe(true)
    })

    it.each([
      ['a malformed expected hash', { expectedHash: 'abc', contentHash: 'abc' }],
      ['an upper-case hash', { expectedHash: 'A'.repeat(64), contentHash: 'A'.repeat(64) }],
      ['an empty hash', { expectedHash: '', contentHash: '' }],
      ['hashes that differ', { contentHash: 'b'.repeat(64) }],
      ['a missing content hash', { contentHash: undefined }],
    ])('rejects %s', (_label, change) => {
      expect(isSourceVerificationEvidence({ ...legacyRecord(), ...change })).toBe(false)
    })

    it('rejects a copied-only record with nothing measured', () => {
      expect(isSourceVerificationEvidence({ expectedHash: HASH })).toBe(false)
    })

    it('checks the hash the caller expects', () => {
      expect(isSourceVerificationEvidence(legacyRecord(), { expectedHash: HASH })).toBe(true)
      expect(isSourceVerificationEvidence(legacyRecord(), { expectedHash: 'b'.repeat(64) })).toBe(
        false
      )
    })
  })

  describe('rule 3: validator', () => {
    it.each([
      ['a missing validator', undefined],
      ['a string validator', 'etag'],
      ['a missing kind', { value: 'x' }],
      ['a missing value', { kind: 'x' }],
      ['an empty kind', { kind: '', value: 'x' }],
      ['an empty value', { kind: 'x', value: '' }],
      ['a kind over the limit', { kind: 'k'.repeat(33), value: 'x' }],
      ['a value over the limit', { kind: 'x', value: 'v'.repeat(1025) }],
    ])('rejects %s', (_label, validator) => {
      expect(isSourceVerificationEvidence({ ...legacyRecord(), validator })).toBe(false)
    })

    it('accepts values at the limit', () => {
      expect(
        isSourceVerificationEvidence({
          ...legacyRecord(),
          validator: { kind: 'k'.repeat(32), value: 'v'.repeat(1024) },
        })
      ).toBe(true)
    })
  })

  describe('rule 4: verifiedAt', () => {
    it.each([
      ['a missing value', undefined],
      ['a number', 1_790_000_000],
      ['a date without a time', '2026-10-31'],
      ['text', 'yesterday'],
      ['an impossible date', '2026-13-45T00:00:00.000Z'],
    ])('rejects %s', (_label, verifiedAt) => {
      expect(isSourceVerificationEvidence({ ...legacyRecord(), verifiedAt })).toBe(false)
    })

    it('accepts an offset', () => {
      expect(
        isSourceVerificationEvidence({
          ...legacyRecord(),
          verifiedAt: '2026-10-31T13:00:00+07:00',
        })
      ).toBe(true)
    })
  })

  describe('rule 5: size', () => {
    it.each([
      ['negative', -1],
      ['fractional', 1.5],
      ['a string', '10'],
      ['unsafe', Number.MAX_SAFE_INTEGER + 1],
    ])('rejects a size that is %s', (_label, size) => {
      expect(isSourceVerificationEvidence({ ...legacyRecord(), size })).toBe(false)
    })

    it('accepts zero', () => {
      expect(isSourceVerificationEvidence({ ...legacyRecord(), size: 0 })).toBe(true)
    })
  })

  describe('rules 6 and 7: known values', () => {
    it('rejects an unknown readBasis', () => {
      expect(isSourceVerificationEvidence({ ...legacyRecord(), readBasis: 'guess' })).toBe(false)
    })

    it('rejects an unknown fallback reason', () => {
      expect(
        isSourceVerificationEvidence({ ...legacyRecord(), preconditionFallback: 'other' })
      ).toBe(false)
    })
  })

  describe('rule 8: readBasis and preconditionFallback', () => {
    it.each([
      // Legacy records written before readBasis existed.
      [undefined, undefined, true],
      [undefined, 'changed', true],
      [undefined, 'unsupported-kind', true],
      [undefined, 'unestablishable', true],
      ['fallback', 'changed', true],
      ['fallback', 'unsupported-kind', true],
      ['fallback', 'unestablishable', true],
      ['fallback', undefined, false],
      ['expected', undefined, true],
      ['unconditional', undefined, true],
      ['expected', 'changed', false],
      ['unconditional', 'unestablishable', false],
    ])('readBasis %s with fallback %s is %s', (readBasis, preconditionFallback, valid) => {
      expect(
        isSourceVerificationEvidence({
          ...legacyRecord(),
          ...(readBasis != null && { readBasis }),
          ...(preconditionFallback != null && { preconditionFallback }),
        })
      ).toBe(valid)
    })
  })
})
