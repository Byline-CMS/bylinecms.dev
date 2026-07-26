/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { SearchProvider } from '@byline/core'
import { createPortableSearchAnalyzer, type PortableSearchAnalyzer } from '@byline/search-analysis'
import type { Pool } from 'mysql2/promise'

import { migrate } from './migrate.js'
import { MySqlSearchProvider } from './mysql-search-provider.js'

export { buildIndexRow, type IndexRow, type WeightClass, weightClass } from './build-index-row.js'
export { SearchAnalyzerMismatchError } from './errors.js'
export { type MigrateOptions, type MigrateResult, migrate } from './migrate.js'
export { MySqlSearchProvider } from './mysql-search-provider.js'

export interface MySqlSearchOptions {
  /** The host's existing mysql2 promise pool, normally `db.pool`. */
  pool: Pool
  /** Development convenience; production should await `migrate(pool)`. */
  autoMigrate?: boolean
  /** Portable analyzer fallback locale. Defaults to `en`. */
  defaultLocale?: string
  /** Custom versioned portable analyzer. */
  analyzer?: PortableSearchAnalyzer
  /** Optional migration progress sink. */
  log?: (message: string) => void
}

/** Construct the MySQL FULLTEXT provider while reusing the host pool. */
export function mysqlSearch(options: MySqlSearchOptions): SearchProvider {
  const analyzer =
    options.analyzer ?? createPortableSearchAnalyzer({ defaultLocale: options.defaultLocale })

  if (options.autoMigrate === true) {
    void migrate(options.pool, { log: options.log }).catch((error) => {
      const message = `[search-mysql] autoMigrate failed: ${(error as Error).message}`
      if (options.log) options.log(message)
      else console.error(message)
    })
  }

  return new MySqlSearchProvider(options.pool, analyzer)
}
