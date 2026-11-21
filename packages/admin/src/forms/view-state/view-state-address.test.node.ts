/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { isTrustedAddress, trustedAddress } from './view-state-address'

describe('trustedAddress', () => {
  it('keeps id-addressed paths whole', () => {
    expect(trustedAddress('content[id=a1].body')).toBe('content[id=a1].body')
  })
  it('cuts before the first positional segment', () => {
    expect(trustedAddress('content[id=a1].columns[2].text')).toBe('content[id=a1].columns')
    expect(trustedAddress('content[2].text')).toBe('content')
  })
  it('returns plain paths unchanged', () => {
    expect(trustedAddress('title')).toBe('title')
  })
  it('returns an empty string when the first segment is positional', () => {
    expect(trustedAddress('[0].x')).toBe('')
  })
  it('returns an empty string when the path does not parse', () => {
    expect(trustedAddress('a[')).toBe('')
  })
})

describe('isTrustedAddress', () => {
  it('is false for positional paths and true otherwise', () => {
    expect(isTrustedAddress('content[0]')).toBe(false)
    expect(isTrustedAddress('content[id=a].x')).toBe(true)
    expect(isTrustedAddress('title')).toBe(true)
    expect(isTrustedAddress('')).toBe(false)
  })
})
