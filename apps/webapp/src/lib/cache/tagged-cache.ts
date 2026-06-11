/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Tag layer over a `cache-manager` instance.
 *
 * Adds tag-based invalidation (`invalidateTag`) on top of the plain
 * key/value LRU. This is the corrected successor to infonomic.io's
 * `TagsManager`, which kept a single unbounded `Map<key, Set<tag>>` that
 * was never pruned when the underlying entry expired (TTL) or was evicted
 * (LRU) — a slow memory leak on a long-lived origin process with high key
 * cardinality (collection × query × page × locale × mode). It also scanned
 * *every* tracked key on each `invalidateTag` (O(n)).
 *
 * Fixes here (see docs/DATA-CACHE-DESIGN.md → "The tag-map fix"):
 *
 *   1. The `keyToTags` map is itself a **bounded LRU**, capped at
 *      `maxTrackedKeys` (defaults to the data cache's `lruSize`). An
 *      insertion-ordered `Map` is the LRU: re-tracking moves a key to the
 *      end, and when the cap is exceeded the least-recently-tracked key is
 *      evicted and its reverse-index references are cleaned. The tag
 *      bookkeeping can therefore never outgrow the data cache it shadows —
 *      no timers, no background sweep.
 *
 *   2. A reverse index `tagToKeys: Map<tag, Set<key>>` makes
 *      `invalidateTag` O(keys-for-this-tag) instead of O(all-keys).
 *
 *   3. Invalidation is **self-healing**: deleting a key removes it from
 *      every tag set, and `del()` on an already-evicted key is a harmless
 *      no-op. A key that expired from the data cache (TTL) but is still
 *      within the most-recent `maxTrackedKeys` window lingers in the tag
 *      maps only until it is pushed out or its tag is next invalidated —
 *      bounded, and correctness-neutral.
 *
 * The value side is untouched: `wrap` delegates straight to
 * `cache-manager.wrap`, preserving its `refreshThreshold` (in-memory SWR)
 * and single-flight coalescing of concurrent calls for the same key.
 */

import type { Cache } from 'cache-manager'

import { LRU_SIZE } from './cache-manager'

export interface CacheOptions {
  ttl?: number
  refreshThreshold?: number
  tags?: string[]
}

export interface CacheWithTags {
  store(key: string, data: unknown, options?: CacheOptions): Promise<void>
  wrap<T>(key: string, fn: () => Promise<T>, options?: CacheOptions): Promise<T>
  retrieve<T = unknown>(key: string): Promise<T | null>
  invalidateTag(tag: string): Promise<void>
  invalidateKey(key: string): Promise<void>
  clear(): Promise<true>
}

export class TaggedCache implements CacheWithTags {
  private readonly cache: Cache
  /** Bounded, insertion-ordered LRU of key → its tags. */
  private readonly keyToTags = new Map<string, Set<string>>()
  /** Reverse index: tag → keys carrying it. Kept in lockstep with `keyToTags`. */
  private readonly tagToKeys = new Map<string, Set<string>>()
  private readonly maxTrackedKeys: number

  constructor(cache: Cache, maxTrackedKeys: number = LRU_SIZE) {
    this.cache = cache
    this.maxTrackedKeys = maxTrackedKeys
  }

  /**
   * Record (or refresh) the tags for a key and enforce the LRU bound.
   * Moving the key to the end of the insertion order marks it
   * most-recently-tracked; evicting from the front drops the
   * least-recently-tracked key and its reverse-index references.
   */
  private track(key: string, tags?: string[]): void {
    if (tags == null || tags.length === 0) return

    // Refresh recency: re-inserting moves the key to the end of the Map.
    const existing = this.keyToTags.get(key)
    if (existing != null) this.keyToTags.delete(key)
    const keyTags = existing ?? new Set<string>()
    this.keyToTags.set(key, keyTags)

    for (const tag of tags) {
      keyTags.add(tag)
      let keysForTag = this.tagToKeys.get(tag)
      if (keysForTag == null) {
        keysForTag = new Set<string>()
        this.tagToKeys.set(tag, keysForTag)
      }
      keysForTag.add(key)
    }

    // Enforce the bound. `Map` iterates in insertion order, so the first
    // key is the least-recently-tracked.
    while (this.keyToTags.size > this.maxTrackedKeys) {
      const oldestKey = this.keyToTags.keys().next().value as string | undefined
      if (oldestKey == null) break
      this.forgetTags(oldestKey)
    }
  }

  /** Drop a key from both indexes (does NOT touch the data cache). */
  private forgetTags(key: string): void {
    const tags = this.keyToTags.get(key)
    if (tags == null) return
    for (const tag of tags) {
      const keysForTag = this.tagToKeys.get(tag)
      if (keysForTag == null) continue
      keysForTag.delete(key)
      if (keysForTag.size === 0) this.tagToKeys.delete(tag)
    }
    this.keyToTags.delete(key)
  }

  async store(key: string, data: unknown, options?: CacheOptions): Promise<void> {
    this.track(key, options?.tags)
    await this.cache.set(key, data, options?.ttl)
  }

  async wrap<T>(key: string, fn: () => Promise<T>, options?: CacheOptions): Promise<T> {
    this.track(key, options?.tags)
    // cache-manager.wrap(key, fn, ttl, refreshThreshold) — retains SWR via
    // refreshThreshold and coalesces concurrent calls for the same key.
    return this.cache.wrap(key, fn, options?.ttl, options?.refreshThreshold)
  }

  async retrieve<T = unknown>(key: string): Promise<T | null> {
    const value = await this.cache.get<T>(key)
    return value ?? null
  }

  /** Invalidate every key carrying `tag`. O(keys-for-this-tag). */
  async invalidateTag(tag: string): Promise<void> {
    const keysForTag = this.tagToKeys.get(tag)
    if (keysForTag == null) return
    // Snapshot before mutation — `forgetTags` mutates the same sets.
    for (const key of [...keysForTag]) {
      await this.cache.del(key)
      this.forgetTags(key)
    }
    this.tagToKeys.delete(tag)
  }

  async invalidateKey(key: string): Promise<void> {
    await this.cache.del(key)
    this.forgetTags(key)
  }

  async clear(): Promise<true> {
    await this.cache.clear()
    this.keyToTags.clear()
    this.tagToKeys.clear()
    return true
  }

  /**
   * Tag-bookkeeping sizes. Both are bounded by `maxTrackedKeys`, so this is
   * a cheap health signal — `trackedKeys` should never exceed the configured
   * cap. Useful for an ops endpoint and for asserting the LRU bound in tests.
   */
  stats(): { trackedKeys: number; trackedTags: number } {
    return { trackedKeys: this.keyToTags.size, trackedTags: this.tagToKeys.size }
  }
}
