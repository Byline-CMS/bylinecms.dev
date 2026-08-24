/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AnalyticsStore } from '@byline/analytics'
import type { Pool } from 'pg'

import { migrate } from './migrate.js'
import { PostgresAnalyticsStore } from './postgres-analytics-store.js'

export { type MigrateOptions, type MigrateResult, migrate } from './migrate.js'
export { PostgresAnalyticsStore } from './postgres-analytics-store.js'

export interface PostgresAnalyticsStoreOptions {
  pool: Pool
  autoMigrate?: boolean
  log?: (message: string) => void
}

export function postgresAnalyticsStore(options: PostgresAnalyticsStoreOptions): AnalyticsStore {
  if (options.autoMigrate === true) {
    void migrate(options.pool, { log: options.log }).catch((error) => {
      const message = `[analytics-postgres] autoMigrate failed: ${(error as Error).message}`
      if (options.log) options.log(message)
      else console.error(message)
    })
  }
  return new PostgresAnalyticsStore(options.pool)
}
