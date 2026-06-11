/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * The underlying in-memory store for the L1 data cache.
 *
 * Stack (all small, actively-maintained, no native addons):
 *   - `cache-manager`            — orchestration: `wrap`, `get`/`set`/`del`,
 *                                  `refreshThreshold` (in-memory SWR), and
 *                                  single-flight coalescing of concurrent
 *                                  `wrap` calls for the same key.
 *   - `keyv`                     — the store interface cache-manager talks to.
 *   - `cacheable` (KeyvCacheableMemory) — the bounded LRU itself.
 *
 * Tag-based invalidation is layered on top in `tagged-cache.ts` — neither
 * cache-manager nor cacheable@2 ships tags natively.
 *
 * See docs/DATA-CACHE-DESIGN.md for the full rationale.
 */

import { type Cache, createCache as createCacheManager } from 'cache-manager'
import { KeyvCacheableMemory } from 'cacheable'
import { Keyv } from 'keyv'

/** Max number of entries the LRU holds before evicting the least-recently-used. */
export const LRU_SIZE = 5000

/** Default per-entry time-to-live (ms). Short by design — this is a hot-path backstop. */
export const DEFAULT_TTL_MS = 60_000

const createCache = (): Cache => {
  // lruSize = 5000 entries. If each cached find-result were ~50KB, a full
  // cache would hold ~250MB. Tune lruSize to the deployment's memory budget.
  const store = new KeyvCacheableMemory({ ttl: DEFAULT_TTL_MS, lruSize: LRU_SIZE })
  const keyv = new Keyv({ store })
  return createCacheManager({ stores: [keyv] })
}

let cacheManager: Cache | undefined

export const getCacheManager = (): Cache => {
  cacheManager ??= createCache()
  return cacheManager
}
