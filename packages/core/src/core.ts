/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { defineServerConfig } from './config/config.js'
import { Registry } from './lib/registry.js'
import type {
  CollectionDefinition,
  IDbAdapter,
  IStorageProvider,
  ServerConfig,
} from './@types/index.js'

export interface BylineCore {
  config: ServerConfig
  collections: CollectionDefinition[]
  db: IDbAdapter
  storage: IStorageProvider | undefined
}

/**
 * Initialize Byline CMS core services via the typed registry.
 *
 * This is the recommended server-side entry point. It composes the
 * dependency graph and populates the global config singleton for
 * backward compatibility with `getServerConfig()`.
 */
export const initBylineCore = (config: ServerConfig): BylineCore => {
  const registry = new Registry()
    .addValue('config', config)
    .addValue('collections', config.collections)
    .addValue('db', config.db)
    .addValue('storage', config.storage)

  const composed = registry.compose({})

  // Backward compat: populate globalThis so getServerConfig() still works
  defineServerConfig(config)

  return {
    config: composed.config,
    collections: composed.collections,
    db: composed.db,
    storage: composed.storage,
  }
}
