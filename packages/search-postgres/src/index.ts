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
import { createPortableSearchAnalyzer, type PortableSearchAnalyzer } from '@byline/search-analysis'
import type { Pool } from 'pg'

import { migrate } from './migrate.js'
import { PostgresSearchProvider } from './postgres-search-provider.js'

export { buildIndexRow, type IndexRow, type WeightClass, weightClass } from './build-index-row.js'
export { SearchAnalyzerMismatchError } from './errors.js'
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
   * Locale used when neither indexed content nor a query supplies one.
   * Defaults to `en`.
   */
  defaultLocale?: string
  /**
   * Custom portable analyzer, typically carrying versioned language
   * expanders. Defaults to `createPortableSearchAnalyzer({ defaultLocale })`.
   *
   * Changing the analyzer fingerprint requires rebuilding the affected
   * collections before they can be searched or indexed.
   */
  analyzer?: PortableSearchAnalyzer
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
  const analyzer =
    options.analyzer ?? createPortableSearchAnalyzer({ defaultLocale: options.defaultLocale })

  if (options.autoMigrate === true) {
    void migrate(options.pool, { log: options.log }).catch((error) => {
      const message = `[search-postgres] autoMigrate failed: ${(error as Error).message}`
      if (options.log) options.log(message)
      else console.error(message)
    })
  }

  return new PostgresSearchProvider(options.pool, analyzer)
}
