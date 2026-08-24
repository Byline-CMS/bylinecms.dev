/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { runAnalyticsStoreConformanceSuite } from '@byline/analytics-conformance'
import mysql from 'mysql2/promise'
import { beforeAll, describe, expect, it } from 'vitest'

import { type MigrateResult, MySqlAnalyticsStore, migrate } from '../src/index.js'

const connectionString = assertTestDatabase(process.env.BYLINE_DB_MYSQL_CONNECTION_STRING)
// Intentionally use mysql2's default timezone behavior. The store must preserve
// UTC day attribution without relying on a caller-specific pool option.
const pool = mysql.createPool({ uri: connectionString, connectionLimit: 6 })
let concurrentMigrationResults: MigrateResult[] = []

beforeAll(async () => {
  await dropSchema()
  concurrentMigrationResults = await Promise.all([migrate(pool), migrate(pool)])
})

describe('MySQL analytics migrations', () => {
  it('serializes concurrent runners and applies each version once', () => {
    expect(concurrentMigrationResults.map((result) => result.applied.length).sort()).toEqual([0, 1])
    expect(concurrentMigrationResults.flatMap((result) => result.applied)).toEqual([1])
  })
})

runAnalyticsStoreConformanceSuite({
  createStore: () => new MySqlAnalyticsStore(pool),
  async migrate() {
    await migrate(pool)
  },
  async reset() {
    for (const table of [
      'byline_analytics_event',
      'byline_analytics_salt',
      'byline_analytics_daily_path',
      'byline_analytics_daily_site',
      'byline_analytics_daily_referrer',
      'byline_analytics_daily_country',
      'byline_analytics_rollup_state',
    ]) {
      await pool.query(`TRUNCATE TABLE ${table}`)
    }
  },
  async teardown() {
    await pool.end()
  },
})

async function dropSchema(): Promise<void> {
  for (const table of [
    'byline_analytics_rollup_state',
    'byline_analytics_daily_country',
    'byline_analytics_daily_referrer',
    'byline_analytics_daily_site',
    'byline_analytics_daily_path',
    'byline_analytics_salt',
    'byline_analytics_event',
    'byline_analytics_migrations',
  ]) {
    await pool.query(`DROP TABLE IF EXISTS ${table}`)
  }
}

function assertTestDatabase(value: string | undefined): string {
  if (value == null) {
    throw new Error(
      'BYLINE_DB_MYSQL_CONNECTION_STRING is not set. Create packages/analytics-mysql/.env.test.'
    )
  }
  const database = new URL(value).pathname.replace(/^\//u, '')
  if (!database.endsWith('_test')) {
    throw new Error(`Refusing analytics tests against "${database}"; it must end in "_test"`)
  }
  return value
}
