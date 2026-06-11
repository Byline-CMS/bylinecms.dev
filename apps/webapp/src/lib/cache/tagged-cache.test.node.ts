/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createCache } from 'cache-manager'
import { KeyvCacheableMemory } from 'cacheable'
import { Keyv } from 'keyv'
import { beforeEach, describe, expect, it } from 'vitest'

import { TaggedCache } from './tagged-cache'

function makeCache(maxTrackedKeys?: number): TaggedCache {
  const store = new KeyvCacheableMemory({ ttl: 60_000, lruSize: 5000 })
  const cacheManager = createCache({ stores: [new Keyv({ store })] })
  return new TaggedCache(cacheManager, maxTrackedKeys)
}

describe('TaggedCache', () => {
  let cache: TaggedCache

  beforeEach(async () => {
    cache = makeCache()
    await cache.clear()
  })

  it('stores and retrieves by key', async () => {
    await cache.store('k1', { value: 42 }, { tags: ['t1'] })
    expect(await cache.retrieve('k1')).toEqual({ value: 42 })
  })

  it('returns null for a miss', async () => {
    expect(await cache.retrieve('missing')).toBeNull()
  })

  it('invalidates by key', async () => {
    await cache.store('k1', 'foo')
    await cache.invalidateKey('k1')
    expect(await cache.retrieve('k1')).toBeNull()
  })

  it('invalidates by tag', async () => {
    await cache.store('k1', 'bar', { tags: ['t1'] })
    await cache.invalidateTag('t1')
    expect(await cache.retrieve('k1')).toBeNull()
  })

  it('invalidates every key sharing a tag', async () => {
    await cache.store('k1', 'a', { tags: ['shared'] })
    await cache.store('k2', 'b', { tags: ['shared', 'other'] })
    await cache.invalidateTag('shared')
    expect(await cache.retrieve('k1')).toBeNull()
    expect(await cache.retrieve('k2')).toBeNull()
  })

  it('wrap caches the function result', async () => {
    let calls = 0
    const fn = async () => {
      calls++
      return 42
    }
    expect(await cache.wrap('k1', fn, { tags: ['t1'] })).toBe(42)
    expect(await cache.wrap('k1', fn, { tags: ['t1'] })).toBe(42)
    expect(calls).toBe(1) // second call served from cache
  })

  it('drops all tag bookkeeping for a tag after invalidateTag', async () => {
    await cache.store('k1', 'a', { tags: ['t1'] })
    await cache.store('k2', 'b', { tags: ['t1'] })
    expect(cache.stats().trackedKeys).toBe(2)
    await cache.invalidateTag('t1')
    // The fix: both indexes are cleaned, not just the data entries.
    expect(cache.stats()).toEqual({ trackedKeys: 0, trackedTags: 0 })
  })

  // The tag-map fix: bookkeeping is a bounded LRU and can never outgrow the
  // data cache, even when entries are never explicitly invalidated.
  it('bounds tracked keys to maxTrackedKeys (LRU eviction of bookkeeping)', async () => {
    const bounded = makeCache(2)
    await bounded.store('k1', 'a', { tags: ['t1'] })
    await bounded.store('k2', 'b', { tags: ['t1'] })
    await bounded.store('k3', 'c', { tags: ['t1'] }) // evicts k1's bookkeeping
    expect(bounded.stats().trackedKeys).toBe(2)
  })

  it('re-tracking a key refreshes its recency rather than growing the map', async () => {
    const bounded = makeCache(2)
    await bounded.store('k1', 'a', { tags: ['t1'] })
    await bounded.store('k2', 'b', { tags: ['t1'] })
    await bounded.store('k1', 'a2', { tags: ['t1'] }) // refresh k1 → k2 is now oldest
    await bounded.store('k3', 'c', { tags: ['t1'] }) // evicts k2's bookkeeping
    expect(bounded.stats().trackedKeys).toBe(2)
    // k1 was refreshed so it survives and is still tag-invalidatable.
    await bounded.invalidateTag('t1')
    expect(await bounded.retrieve('k1')).toBeNull()
  })
})
