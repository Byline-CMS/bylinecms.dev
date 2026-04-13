/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type Logger as PinoLogger, pino } from 'pino'

import { defineServerConfig } from './config/config.js'
import { type BylineLogger, createBylineLogger, defineLogger } from './lib/logger.js'
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
  logger: BylineLogger
}

/**
 * Initialize Byline CMS core services via the typed registry.
 *
 * This is the recommended server-side entry point. It composes the
 * dependency graph and populates the global config singleton for
 * backward compatibility with `getServerConfig()`.
 *
 * @param config - Server configuration (collections, db, storage, i18n).
 * @param pinoLogger - Optional raw Pino instance. Defaults to `pino({ level: 'info' })`.
 */
export const initBylineCore = (
  config: ServerConfig,
  pinoLogger: PinoLogger = pino({ level: 'info' })
): BylineCore => {
  const registry = new Registry()
    .addValue('config', config)
    .addValue('collections', config.collections)
    .addValue('db', config.db)
    .addValue('storage', config.storage)
    .addFactory('logger', createBylineLogger)

  const composed = registry.compose({ pinoLogger })

  // Backward compat: populate globalThis singletons
  defineServerConfig(config)
  defineLogger(composed.logger)

  return {
    config: composed.config,
    collections: composed.collections,
    db: composed.db,
    storage: composed.storage,
    logger: composed.logger,
  }
}
