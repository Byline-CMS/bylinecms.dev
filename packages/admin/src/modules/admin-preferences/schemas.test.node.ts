/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { ANALYTICS_DASHBOARD_PERIODS } from '@byline/analytics/config'
import { describe, expect, it } from 'vitest'

import {
  analyticsViewPreferenceValueSchema,
  listViewPreferenceValueSchema,
  preferenceScopeSchema,
  resolvePreferenceValueSchema,
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

describe('analyticsViewPreferenceValueSchema', () => {
  it('accepts every period the dashboard offers', () => {
    for (const period of ANALYTICS_DASHBOARD_PERIODS) {
      expect(analyticsViewPreferenceValueSchema.safeParse({ period }).success).toBe(true)
    }
  })

  it('rejects periods the dashboard does not offer', () => {
    expect(analyticsViewPreferenceValueSchema.safeParse({ period: 45 }).success).toBe(false)
    // The URL carries `?period=30`; the stored value is the parsed number.
    expect(analyticsViewPreferenceValueSchema.safeParse({ period: '30' }).success).toBe(false)
    expect(analyticsViewPreferenceValueSchema.safeParse({ period: 'lifetime' }).success).toBe(false)
  })

  it('rejects an empty payload and unknown keys', () => {
    expect(analyticsViewPreferenceValueSchema.safeParse({}).success).toBe(false)
    expect(analyticsViewPreferenceValueSchema.safeParse({ period: 7, page_size: 30 }).success).toBe(
      false
    )
  })
})

describe('resolvePreferenceValueSchema', () => {
  it('routes each registered scope family to its own value schema', () => {
    expect(resolvePreferenceValueSchema('collections.docs.list')).toBe(
      listViewPreferenceValueSchema
    )
    expect(resolvePreferenceValueSchema('collections.media-items.list')).toBe(
      listViewPreferenceValueSchema
    )
    expect(resolvePreferenceValueSchema('analytics.dashboard')).toBe(
      analyticsViewPreferenceValueSchema
    )
  })

  it('returns undefined for an unregistered scope family', () => {
    expect(resolvePreferenceValueSchema('collections.docs')).toBeUndefined()
    expect(resolvePreferenceValueSchema('collections.docs.list.extra')).toBeUndefined()
    expect(resolvePreferenceValueSchema('analytics')).toBeUndefined()
    expect(resolvePreferenceValueSchema('made.up.scope')).toBeUndefined()
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

  it('validates the value against the schema its scope selects', () => {
    expect(
      setPreferenceRequestSchema.safeParse({
        scope: 'analytics.dashboard',
        value: { period: 'ytd' },
      }).success
    ).toBe(true)
    // Each family rejects the other's keys — the point of keying by scope.
    expect(
      setPreferenceRequestSchema.safeParse({
        scope: 'collections.docs.list',
        value: { period: 'ytd' },
      }).success
    ).toBe(false)
    expect(
      setPreferenceRequestSchema.safeParse({
        scope: 'analytics.dashboard',
        value: { page_size: 30 },
      }).success
    ).toBe(false)
  })

  it('refuses to mint rows for an unregistered scope family', () => {
    expect(
      setPreferenceRequestSchema.safeParse({ scope: 'made.up.scope', value: { period: 7 } }).success
    ).toBe(false)
  })
})
