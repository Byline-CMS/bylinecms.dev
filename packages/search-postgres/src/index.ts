/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `@byline/search-postgres` — the built-in Postgres full-text `SearchProvider`.
 *
 * Reuses the host's existing Postgres connection (no new infrastructure) and
 * owns its own schema (a weighted `tsvector` index table; see `migrate`).
 * Register it on `ServerConfig.search`:
 *
 * ```ts
 * import { pgAdapter } from '@byline/db-postgres'
 * import { postgresSearch } from '@byline/search-postgres'
 *
 * const db = pgAdapter({ connectionString, collections, defaultContentLocale })
 *
 * defineServerConfig({
 *   db,
 *   // Dev convenience: ensure the search schema at boot. In production,
 *   // prefer running `migrate(db.pool)` (or the SQL files) deliberately.
 *   search: postgresSearch({ pool: db.pool, autoMigrate: true }),
 * })
 * ```
 */

import type { SearchProvider } from '@byline/core'
import type { Pool } from 'pg'

import { createRegconfigResolver } from './locale-regconfig.js'
import { migrate } from './migrate.js'
import { PostgresSearchProvider } from './postgres-search-provider.js'

export { buildIndexRow, type IndexRow, type WeightClass, weightClass } from './build-index-row.js'
export {
  createRegconfigResolver,
  DEFAULT_FALLBACK_REGCONFIG,
  type RegconfigResolver,
} from './locale-regconfig.js'
export { type MigrateOptions, type MigrateResult, migrate } from './migrate.js'
export { PostgresSearchProvider } from './postgres-search-provider.js'

export interface PostgresSearchOptions {
  /**
   * The host's existing pg connection pool — typically `db.pool` from
   * `pgAdapter`. Reused so the search index lives in the same database with
   * no second connection.
   */
  pool: Pool
  /**
   * When `true`, ensure the search schema by running pending migrations at
   * construction (idempotent). Defaults to `false` — prefer running
   * `migrate(pool)` (or the SQL files) deliberately in production, per the
   * package README. Convenient for development.
   */
  autoMigrate?: boolean
  /**
   * Override or extend the locale → Postgres `regconfig` (text-search
   * language) map. Merged over the built-in defaults.
   */
  localeRegconfig?: Record<string, string>
  /**
   * Fallback `regconfig` for locales not in the map. Defaults to `'simple'`
   * (no stemming / stop-words — unstemmed but correct).
   */
  fallbackRegconfig?: string
  /** Optional sink for migration progress lines (e.g. the host logger). */
  log?: (message: string) => void
}

/**
 * Construct the Postgres full-text search provider. Mirrors the established
 * adapter-factory shape (`postgresSearch({ pool })`).
 *
 * Note: `autoMigrate` runs asynchronously and is not awaited here (the
 * factory is synchronous to match the seam). For deterministic startup —
 * especially the first deploy, before any read — call and await
 * `migrate(pool)` explicitly during boot instead.
 */
export function postgresSearch(options: PostgresSearchOptions): SearchProvider {
  const regconfig = createRegconfigResolver(options.localeRegconfig, options.fallbackRegconfig)

  if (options.autoMigrate === true) {
    void migrate(options.pool, { log: options.log }).catch((error) => {
      const message = `[search-postgres] autoMigrate failed: ${(error as Error).message}`
      if (options.log) options.log(message)
      else console.error(message)
    })
  }

  return new PostgresSearchProvider(options.pool, regconfig)
}
