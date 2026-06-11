/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Public surface for the L1 in-memory data cache.
 *
 * `getCache()` is the lazily-constructed singleton tag cache. The free
 * functions are thin conveniences used by `with-cache.ts` (read path) and
 * the collection hooks (invalidation path).
 *
 * `invalidateTag` / `invalidateKey` always invalidate the **local**
 * instance first and synchronously. When `cache.clusterEnabled` is set they
 * additionally fan out to sibling instances — fire-and-forget, so a network
 * failure can never roll back or stall the editor's save that triggered the
 * hook.
 *
 * See docs/DATA-CACHE-DESIGN.md.
 */

import { getServerConfig } from '@/config'
import { getCacheManager } from './cache-manager'
import { invalidateClusterCacheKey, invalidateClusterCacheTag } from './cluster-manager'
import { type CacheOptions, type CacheWithTags, TaggedCache } from './tagged-cache'

export type { CacheOptions, CacheWithTags } from './tagged-cache'

let cache: CacheWithTags | undefined

export const getCache = (): CacheWithTags => {
  cache ??= new TaggedCache(getCacheManager())
  return cache
}

export async function store(key: string, data: unknown, options?: CacheOptions): Promise<void> {
  await getCache().store(key, data, options)
}

export function storeFunction<T>(
  key: string,
  fn: () => Promise<T>,
  options?: CacheOptions
): () => Promise<T> {
  const c = getCache()
  return () => c.wrap(key, fn, options)
}

export async function retrieve<T = unknown>(key: string): Promise<T | null> {
  return getCache().retrieve<T>(key)
}

export async function invalidateTag(tag: string): Promise<void> {
  // Local first — always synchronous and authoritative for this instance.
  await getCache().invalidateTag(tag)
  // Cluster fan-out is fire-and-forget: never block the caller (a collection
  // hook on the editor's save path) on a cross-instance network round-trip.
  if (getServerConfig().cache.clusterEnabled) {
    void invalidateClusterCacheTag(tag).catch((error) => {
      console.error('[cache] cluster tag fan-out failed', { tag, error })
    })
  }
}

export async function invalidateKey(key: string): Promise<void> {
  await getCache().invalidateKey(key)
  if (getServerConfig().cache.clusterEnabled) {
    void invalidateClusterCacheKey(key).catch((error) => {
      console.error('[cache] cluster key fan-out failed', { key, error })
    })
  }
}

export async function clear(): Promise<true> {
  return getCache().clear()
}
