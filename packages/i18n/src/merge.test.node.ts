/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it, vi } from 'vitest'

import { mergeTranslations } from './merge.js'
import type { TranslationBundle } from './types.js'

describe('mergeTranslations', () => {
  it('merges disjoint bundles into a single locale tree', () => {
    const a: TranslationBundle = { en: { ns1: { foo: 'A' } } }
    const b: TranslationBundle = { en: { ns2: { bar: 'B' } } }
    const out = mergeTranslations(a, b)
    expect(out).toEqual({ en: { ns1: { foo: 'A' }, ns2: { bar: 'B' } } })
  })

  it('later bundles override earlier bundles at the (locale, namespace, key) grain', () => {
    const a: TranslationBundle = { en: { ns: { greeting: 'Hello' } } }
    const b: TranslationBundle = { en: { ns: { greeting: 'Hi there' } } }
    const out = mergeTranslations(a, b)
    expect(out.en?.ns?.greeting).toBe('Hi there')
  })

  it('does not flag identical-value writes as collisions', () => {
    const onCollision = vi.fn()
    mergeTranslations(
      { onCollision },
      { en: { ns: { foo: 'same' } } },
      { en: { ns: { foo: 'same' } } }
    )
    expect(onCollision).not.toHaveBeenCalled()
  })

  it('invokes onCollision once per actual override', () => {
    const onCollision = vi.fn()
    mergeTranslations(
      { onCollision },
      { en: { ns: { foo: 'A', bar: 'X' } } },
      { en: { ns: { foo: 'B', baz: 'Y' } } }
    )
    expect(onCollision).toHaveBeenCalledTimes(1)
    expect(onCollision).toHaveBeenCalledWith({
      locale: 'en',
      namespace: 'ns',
      key: 'foo',
      previousValue: 'A',
      nextValue: 'B',
    })
  })

  it('is associative — (a, (b, c)) === ((a, b), c)', () => {
    const a: TranslationBundle = { en: { ns: { k1: '1', k2: 'A' } } }
    const b: TranslationBundle = { en: { ns: { k2: 'B', k3: '3' } } }
    const c: TranslationBundle = { en: { ns: { k1: 'X' } } }
    const leftAssoc = mergeTranslations(mergeTranslations(a, b), c)
    const rightAssoc = mergeTranslations(a, mergeTranslations(b, c))
    expect(leftAssoc).toEqual(rightAssoc)
    expect(leftAssoc.en?.ns).toEqual({ k1: 'X', k2: 'B', k3: '3' })
  })

  it('accepts undefined inputs and returns identity', () => {
    const a: TranslationBundle = { en: { ns: { foo: 'A' } } }
    expect(mergeTranslations(undefined, a, undefined)).toEqual(a)
    expect(mergeTranslations()).toEqual({})
  })

  it('produces frozen output at every level', () => {
    const out = mergeTranslations({ en: { ns: { foo: 'A' } } })
    expect(Object.isFrozen(out)).toBe(true)
    expect(Object.isFrozen(out.en)).toBe(true)
    expect(Object.isFrozen(out.en?.ns)).toBe(true)
  })

  it('distinguishes a MergeOptions argument from a bundle by the onCollision function', () => {
    const onCollision = vi.fn()
    // First arg is MergeOptions (has `onCollision` function); second is a bundle.
    const out = mergeTranslations({ onCollision }, { en: { ns: { foo: 'A' } } })
    expect(out.en?.ns?.foo).toBe('A')
  })
})
