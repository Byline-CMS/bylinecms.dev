/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { PortableSearchAnalyzer } from '@byline/search-analysis'
import { runSearchProviderConformanceSuite } from '@byline/search-conformance'
import pg from 'pg'

import { migrate, postgresSearch } from '../src/index.js'

const connectionString = assertTestDatabase(process.env.BYLINE_DB_POSTGRES_CONNECTION_STRING)
const pool = new pg.Pool({ connectionString, max: 4 })

runSearchProviderConformanceSuite({
  createProvider: () => postgresSearch({ pool, defaultLocale: 'en' }),
  createPortableProvider: (analyzer: PortableSearchAnalyzer) => postgresSearch({ pool, analyzer }),
  expectedCapabilities: { highlights: true },

  async migrate(): Promise<void> {
    await migrate(pool)
  },

  async reset(): Promise<void> {
    await pool.query('TRUNCATE byline_search_documents, byline_search_index_metadata')
  },

  async teardown(): Promise<void> {
    await pool.end()
  },
})

function assertTestDatabase(value: string | undefined): string {
  if (value == null) {
    throw new Error(
      'BYLINE_DB_POSTGRES_CONNECTION_STRING is not set. Create packages/search-postgres/.env.test.'
    )
  }

  let databaseName: string
  try {
    databaseName = new URL(value).pathname.replace(/^\//, '')
  } catch (error) {
    throw new Error(
      `BYLINE_DB_POSTGRES_CONNECTION_STRING is not a valid URL: ${(error as Error).message}`
    )
  }

  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `Refusing search conformance tests against database "${databaseName}". ` +
        'The database name must end in "_test".'
    )
  }
  return value
}
