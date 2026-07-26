/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { PortableSearchAnalyzer } from '@byline/search-analysis'
import { runSearchProviderConformanceSuite } from '@byline/search-conformance'
import mysql from 'mysql2/promise'

import { migrate, mysqlSearch } from '../src/index.js'

const connectionString = assertTestDatabase(process.env.BYLINE_DB_MYSQL_CONNECTION_STRING)
const pool = mysql.createPool({
  uri: connectionString,
  connectionLimit: 4,
  timezone: 'Z',
  decimalNumbers: false,
  charset: 'UTF8MB4_0900_AI_CI',
})

runSearchProviderConformanceSuite({
  createProvider: () => mysqlSearch({ pool, defaultLocale: 'en' }),
  createPortableProvider: (analyzer: PortableSearchAnalyzer) => mysqlSearch({ pool, analyzer }),
  expectedCapabilities: { highlights: true },

  async migrate(): Promise<void> {
    await migrate(pool)
  },

  async reset(): Promise<void> {
    await pool.query('DELETE FROM byline_search_documents')
    await pool.query('DELETE FROM byline_search_index_metadata')
  },

  async teardown(): Promise<void> {
    await pool.end()
  },
})

function assertTestDatabase(value: string | undefined): string {
  if (value == null) {
    throw new Error(
      'BYLINE_DB_MYSQL_CONNECTION_STRING is not set. Create packages/search-mysql/.env.test.'
    )
  }

  let databaseName: string
  try {
    databaseName = new URL(value).pathname.replace(/^\//, '')
  } catch (error) {
    throw new Error(
      `BYLINE_DB_MYSQL_CONNECTION_STRING is not a valid URL: ${(error as Error).message}`
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
