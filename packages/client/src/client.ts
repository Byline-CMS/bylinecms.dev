/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  BylineLogger,
  CollectionDefinition,
  IDbAdapter,
  IStorageProvider,
  SlugifierFn,
} from '@byline/core'
import { ERR_NOT_FOUND, getLogger } from '@byline/core'

import { CollectionHandle } from './collection-handle.js'
import type { BylineClientConfig } from './types.js'

/**
 * Resolve a logger for the client in priority order:
 *   1. explicit `config.logger`
 *   2. `getLogger()` if `initBylineCore()` registered one
 *   3. silent no-op fallback
 *
 * The silent fallback is deliberate: `@byline/client` is also the path
 * by which migration scripts, seeders, and one-off tests talk to the
 * storage layer, and those contexts don't run `initBylineCore()`.
 * Throwing here (or logging a warning every time) would force every
 * such script to register a logger they don't care about. Fully-wired
 * runtimes still get the real logger via step 2; callers that want
 * loud logging in a script just pass `config.logger` explicitly.
 */
function resolveLogger(provided: BylineLogger | undefined): BylineLogger {
  if (provided) return provided
  try {
    return getLogger()
  } catch {
    return silentLogger
  }
}

const noop = () => {}
const silentLogger: BylineLogger = {
  log: noop,
  fatal: noop,
  error: noop,
  warn: noop,
  info: noop,
  debug: noop,
  trace: noop,
  silent: noop,
}

/**
 * The main Byline client instance. Holds the database adapter, collection
 * definitions, and optional storage provider. Use `collection(path)` to get
 * a scoped handle for querying and mutating documents.
 */
export class BylineClient {
  readonly db: IDbAdapter
  readonly collections: CollectionDefinition[]
  readonly storage: IStorageProvider | undefined
  readonly logger: BylineLogger
  readonly defaultLocale: string
  readonly slugifier: SlugifierFn | undefined

  /** Cache: collection path → database row ID. */
  private collectionIdCache = new Map<string, string>()

  constructor(config: BylineClientConfig) {
    this.db = config.db
    this.collections = config.collections
    this.storage = config.storage
    this.logger = resolveLogger(config.logger)
    this.defaultLocale = config.defaultLocale ?? 'en'
    this.slugifier = config.slugifier
  }

  /**
   * Get a handle scoped to a single collection. All subsequent read/write
   * operations on the handle are performed against this collection.
   */
  collection(path: string): CollectionHandle {
    const definition = this.collections.find((c) => c.path === path)
    if (!definition) {
      throw ERR_NOT_FOUND({
        message: `Collection not found: '${path}'`,
        details: {
          collectionPath: path,
          available: this.collections.map((c) => c.path),
        },
      })
    }
    return new CollectionHandle(this, definition)
  }

  /**
   * Resolve a collection path to its database row ID. Cached for the
   * lifetime of this client instance.
   */
  async resolveCollectionId(path: string): Promise<string> {
    const cached = this.collectionIdCache.get(path)
    if (cached) return cached

    const row = await this.db.queries.collections.getCollectionByPath(path)
    if (!row) {
      throw ERR_NOT_FOUND({
        message: `Collection '${path}' not found in database`,
        details: { collectionPath: path },
      })
    }

    const id = row.id as string
    this.collectionIdCache.set(path, id)
    return id
  }
}

/**
 * Create a new Byline client instance.
 */
export function createBylineClient(config: BylineClientConfig): BylineClient {
  return new BylineClient(config)
}
