/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it, vi } from 'vitest'

import { assignCounterValues } from './assign-counter-values.js'
import type { FieldSet } from '../@types/index.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCounters(start = 1) {
  let next = start
  const calls: string[] = []
  return {
    counters: {
      ensureCounterGroup: vi.fn(),
      nextCounterValue: vi.fn(async (group: string) => {
        calls.push(group)
        return next++
      }),
    },
    calls,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('assignCounterValues', () => {
  it('is a no-op when no counter fields are declared', async () => {
    const { counters, calls } = makeCounters()
    const fields: FieldSet = [{ name: 'title', type: 'text' }]
    const data = { title: 'hello' }

    await assignCounterValues({ fields, data, counters })

    expect(calls).toEqual([])
    expect(data).toEqual({ title: 'hello' })
  })

  it('allocates a value for a single counter at root on create', async () => {
    const { counters, calls } = makeCounters(42)
    const fields: FieldSet = [
      { name: 'label', type: 'text' },
      { name: 'facetId', type: 'counter', group: 'library-facets' },
    ]
    const data: Record<string, any> = { label: 'Forestry' }

    await assignCounterValues({ fields, data, counters })

    expect(data.facetId).toBe(42)
    expect(calls).toEqual(['library-facets'])
  })

  it('overwrites a caller-supplied counter value on create', async () => {
    const { counters, calls } = makeCounters(7)
    const fields: FieldSet = [{ name: 'facetId', type: 'counter', group: 'library-facets' }]
    const data: Record<string, any> = { facetId: 999 }

    await assignCounterValues({ fields, data, counters })

    expect(data.facetId).toBe(7)
    expect(calls).toEqual(['library-facets'])
  })

  it('allocates separate values for multiple counters across groups', async () => {
    const { counters, calls } = makeCounters(1)
    const fields: FieldSet = [
      { name: 'facetId', type: 'counter', group: 'library-facets' },
      { name: 'regionId', type: 'counter', group: 'region-codes' },
    ]
    const data: Record<string, any> = {}

    await assignCounterValues({ fields, data, counters })

    expect(data.facetId).toBeTypeOf('number')
    expect(data.regionId).toBeTypeOf('number')
    expect(data.facetId).not.toBe(data.regionId)
    expect(calls.sort()).toEqual(['library-facets', 'region-codes'])
  })

  it('descends into group fields and materialises missing group containers', async () => {
    const { counters, calls } = makeCounters(5)
    const fields: FieldSet = [
      {
        name: 'meta',
        type: 'group',
        fields: [
          { name: 'label', type: 'text' },
          { name: 'facetId', type: 'counter', group: 'library-facets' },
        ],
      },
    ]
    const data: Record<string, any> = {}

    await assignCounterValues({ fields, data, counters })

    expect(data.meta).toBeTypeOf('object')
    expect(data.meta.facetId).toBe(5)
    expect(calls).toEqual(['library-facets'])
  })

  it('carries forward the previous version value on update', async () => {
    const { counters, calls } = makeCounters(100)
    const fields: FieldSet = [
      { name: 'label', type: 'text' },
      { name: 'facetId', type: 'counter', group: 'library-facets' },
    ]
    const data: Record<string, any> = { label: 'updated' }
    const previousData = { label: 'previous', facetId: 7 }

    await assignCounterValues({ fields, data, previousData, counters })

    expect(data.facetId).toBe(7)
    expect(calls).toEqual([])
  })

  it('overwrites caller-sent value on update with the previous version value', async () => {
    const { counters, calls } = makeCounters()
    const fields: FieldSet = [{ name: 'facetId', type: 'counter', group: 'library-facets' }]
    const data: Record<string, any> = { facetId: 999 }
    const previousData = { facetId: 7 }

    await assignCounterValues({ fields, data, previousData, counters })

    expect(data.facetId).toBe(7)
    expect(calls).toEqual([])
  })

  it('lazy-allocates on update when the previous version is missing the counter', async () => {
    const { counters, calls } = makeCounters(50)
    const fields: FieldSet = [
      { name: 'label', type: 'text' },
      { name: 'facetId', type: 'counter', group: 'library-facets' },
    ]
    const data: Record<string, any> = { label: 'updated' }
    const previousData = { label: 'previous' } // counter added post-hoc

    await assignCounterValues({ fields, data, previousData, counters })

    expect(data.facetId).toBe(50)
    expect(calls).toEqual(['library-facets'])
  })

  it('carries forward counter inside a group on update', async () => {
    const { counters, calls } = makeCounters(99)
    const fields: FieldSet = [
      {
        name: 'meta',
        type: 'group',
        fields: [{ name: 'facetId', type: 'counter', group: 'library-facets' }],
      },
    ]
    const data: Record<string, any> = { meta: {} }
    const previousData = { meta: { facetId: 12 } }

    await assignCounterValues({ fields, data, previousData, counters })

    expect(data.meta.facetId).toBe(12)
    expect(calls).toEqual([])
  })

  it('treats a non-finite previous value as missing and lazy-allocates', async () => {
    const { counters, calls } = makeCounters(3)
    const fields: FieldSet = [{ name: 'facetId', type: 'counter', group: 'library-facets' }]
    const data: Record<string, any> = {}
    const previousData = { facetId: 'not-a-number' as any }

    await assignCounterValues({ fields, data, previousData, counters })

    expect(data.facetId).toBe(3)
    expect(calls).toEqual(['library-facets'])
  })

  it('does not descend into arrays or blocks (counters are banned there)', async () => {
    // The walker should silently skip these — the structural ban is
    // enforced separately in discoverCounterGroups at boot. Here we
    // just verify the walker doesn't crash on an array/blocks sibling.
    const { counters, calls } = makeCounters(1)
    const fields: FieldSet = [
      { name: 'facetId', type: 'counter', group: 'library-facets' },
      { name: 'tags', type: 'array', fields: [{ name: 'label', type: 'text' }] },
    ]
    const data: Record<string, any> = {
      tags: [{ label: 'a' }, { label: 'b' }],
    }

    await assignCounterValues({ fields, data, counters })

    expect(data.facetId).toBe(1)
    expect(data.tags).toEqual([{ label: 'a' }, { label: 'b' }])
    expect(calls).toEqual(['library-facets'])
  })
})
