/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { canonicalVisitorIdentity, hashAnalyticsVisitor } from './visitor.js'

describe('visitor identity', () => {
  it('length-prefixes components so concatenation cannot be ambiguous', () => {
    expect(canonicalVisitorIdentity('ab', 'c')).not.toEqual(canonicalVisitorIdentity('a', 'bc'))
  })

  it('changes the visitor hash when the daily salt changes', () => {
    const first = hashAnalyticsVisitor(new Uint8Array(32).fill(1), '203.0.113.1', 'Browser/1')
    const second = hashAnalyticsVisitor(new Uint8Array(32).fill(2), '203.0.113.1', 'Browser/1')
    expect(first).not.toBe(second)
  })
})
