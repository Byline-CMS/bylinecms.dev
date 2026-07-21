/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import {
  listViewPreferenceValueSchema,
  preferenceScopeSchema,
  setPreferenceRequestSchema,
} from './schemas.js'

describe('preferenceScopeSchema', () => {
  it('accepts dot-separated scope keys', () => {
    expect(preferenceScopeSchema.safeParse('collections.docs.list').success).toBe(true)
    expect(preferenceScopeSchema.safeParse('collections.media-items.list').success).toBe(true)
  })

  it('rejects empty, spaced, and slash-separated keys', () => {
    expect(preferenceScopeSchema.safeParse('').success).toBe(false)
    expect(preferenceScopeSchema.safeParse('has space').success).toBe(false)
    expect(preferenceScopeSchema.safeParse('a/b').success).toBe(false)
  })
})

describe('listViewPreferenceValueSchema', () => {
  it('accepts a page_size-only payload (partial writes are the norm)', () => {
    expect(listViewPreferenceValueSchema.safeParse({ page_size: 50 }).success).toBe(true)
  })

  it('accepts a sort-only payload', () => {
    expect(listViewPreferenceValueSchema.safeParse({ order: 'title', desc: true }).success).toBe(
      true
    )
  })

  it('enforces the 1-100 page_size bounds', () => {
    expect(listViewPreferenceValueSchema.safeParse({ page_size: 0 }).success).toBe(false)
    expect(listViewPreferenceValueSchema.safeParse({ page_size: 101 }).success).toBe(false)
    expect(listViewPreferenceValueSchema.safeParse({ page_size: 12.5 }).success).toBe(false)
    expect(listViewPreferenceValueSchema.safeParse({ page_size: 1 }).success).toBe(true)
    expect(listViewPreferenceValueSchema.safeParse({ page_size: 100 }).success).toBe(true)
  })

  it('rejects an empty payload and unknown keys', () => {
    expect(listViewPreferenceValueSchema.safeParse({}).success).toBe(false)
    expect(listViewPreferenceValueSchema.safeParse({ page: 7 }).success).toBe(false)
  })
})

describe('setPreferenceRequestSchema', () => {
  it('requires both scope and a non-empty value', () => {
    expect(
      setPreferenceRequestSchema.safeParse({
        scope: 'collections.docs.list',
        value: { page_size: 30 },
      }).success
    ).toBe(true)
    expect(
      setPreferenceRequestSchema.safeParse({ scope: 'collections.docs.list', value: {} }).success
    ).toBe(false)
  })
})
