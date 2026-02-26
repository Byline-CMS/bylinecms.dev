/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionAdminConfig } from './admin-types.js'
import type { CollectionDefinition } from './collection-types.js'
import type { IDbAdapter } from './db-types.js'
import type { IStorageProvider } from './storage-types.js'

export type DbAdapterFn = (args: { connectionString: string }) => IDbAdapter

/**
 * Common configuration shared by the server and client. Contains only
 * serializable, framework-agnostic properties — no React components, no
 * database adapters, no storage providers.
 */
export interface BaseConfig {
  serverURL: string
  i18n: {
    interface: {
      defaultLocale: string
      locales: string[]
    }
    content: {
      defaultLocale: string
      locales: string[]
    }
  }
  collections: CollectionDefinition[]
}

/**
 * Client-side configuration. Extends BaseConfig with admin UI presentation
 * config (React components, formatters, column definitions, etc.).
 *
 * Used by `defineClientConfig()` and consumed by admin UI routes.
 */
export interface ClientConfig extends BaseConfig {
  /** Admin UI configuration for collections (client-side only). */
  admin?: CollectionAdminConfig[]
}

/**
 * Server-side configuration. Extends BaseConfig with database and storage
 * adapters. Deliberately does NOT extend ClientConfig — the server has no
 * knowledge of React components or admin UI presentation logic.
 */
export interface ServerConfig extends BaseConfig {
  db: IDbAdapter
  /**
   * Site-wide default storage provider for upload-enabled collections.
   *
   * This is the fallback used when a collection's own `UploadConfig.storage`
   * is not set. Individual collections can override this by specifying
   * `storage` inside their `upload` config block.
   *
   * Resolution order:
   *   1. `collection.upload.storage`  — collection-level override
   *   2. `ServerConfig.storage`        — site-wide default
   *   3. 500 error if neither is set
   *
   * @example
   * ```ts
   * import { localStorageProvider } from '@byline/storage-local'
   * storage: localStorageProvider({ uploadDir: './public/uploads', baseUrl: '/uploads' })
   * ```
   */
  storage?: IStorageProvider
}
