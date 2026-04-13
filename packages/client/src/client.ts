/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition, IDbAdapter, IStorageProvider } from '@byline/core'
import { ERR_NOT_FOUND } from '@byline/core'

import { CollectionHandle } from './collection-handle.js'
import type { BylineClientConfig } from './types.js'

/**
 * The main Byline client instance. Holds the database adapter, collection
 * definitions, and optional storage provider. Use `collection(path)` to get
 * a scoped handle for querying and mutating documents.
 */
export class BylineClient {
  readonly db: IDbAdapter
  readonly collections: CollectionDefinition[]
  readonly storage: IStorageProvider | undefined

  /** Cache: collection path → database row ID. */
  private collectionIdCache = new Map<string, string>()

  constructor(config: BylineClientConfig) {
    this.db = config.db
    this.collections = config.collections
    this.storage = config.storage
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
