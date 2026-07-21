/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { decodeListReturnState, encodeListReturnState } from './list-return-state.js'

describe('encodeListReturnState / decodeListReturnState', () => {
  it('round-trips a full list search state', () => {
    const search = {
      page: 7,
      page_size: 50,
      order: 'title',
      desc: false,
      query: 'harvest',
      locale: 'fr',
      status: 'draft',
    }
    const encoded = encodeListReturnState(search)
    expect(typeof encoded).toBe('string')
    expect(decodeListReturnState(encoded)).toEqual(search)
  })

  it('returns undefined for an empty search (no point carrying a bare target)', () => {
    expect(encodeListReturnState({})).toBeUndefined()
  })

  it('never carries the transient action param', () => {
    const encoded = encodeListReturnState({ page: 2, action: 'created' })
    expect(decodeListReturnState(encoded)).toEqual({ page: 2 })
  })

  it('decodes desc=false as boolean false (not string-coerced truthiness)', () => {
    const decoded = decodeListReturnState('order=title&desc=false')
    expect(decoded).toEqual({ order: 'title', desc: false })
  })

  it('degrades malformed input to undefined instead of throwing', () => {
    expect(decodeListReturnState(undefined)).toBeUndefined()
    expect(decodeListReturnState('')).toBeUndefined()
    expect(decodeListReturnState('page=notanumber')).toBeUndefined()
    expect(decodeListReturnState('page=0')).toBeUndefined()
    expect(decodeListReturnState('page_size=99999')).toBeUndefined()
  })

  it('drops empty-string values at encode time', () => {
    const encoded = encodeListReturnState({ page: 3, query: '' })
    expect(decodeListReturnState(encoded)).toEqual({ page: 3 })
  })
})
