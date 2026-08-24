/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { runAnalyticsStoreConformanceSuite } from '@byline/analytics-conformance'
import pg from 'pg'
import { beforeAll, describe, expect, it } from 'vitest'

import { type MigrateResult, migrate, PostgresAnalyticsStore } from '../src/index.js'

const connectionString = assertTestDatabase(process.env.BYLINE_DB_POSTGRES_CONNECTION_STRING)
const pool = new pg.Pool({ connectionString, max: 6 })
let concurrentMigrationResults: MigrateResult[] = []

beforeAll(async () => {
  await dropSchema()
  concurrentMigrationResults = await Promise.all([migrate(pool), migrate(pool)])
})

describe('PostgreSQL analytics migrations', () => {
  it('serializes concurrent runners and applies each version once', () => {
    expect(concurrentMigrationResults.map((result) => result.applied.length).sort()).toEqual([0, 1])
    expect(concurrentMigrationResults.flatMap((result) => result.applied)).toEqual([1])
  })
})

runAnalyticsStoreConformanceSuite({
  createStore: () => new PostgresAnalyticsStore(pool),
  async migrate() {
    await migrate(pool)
  },
  async reset() {
    await pool.query(`TRUNCATE
      byline_analytics_event,
      byline_analytics_salt,
      byline_analytics_daily_path,
      byline_analytics_daily_site,
      byline_analytics_daily_referrer,
      byline_analytics_daily_country,
      byline_analytics_rollup_state
      RESTART IDENTITY`)
  },
  async teardown() {
    await pool.end()
  },
})

async function dropSchema(): Promise<void> {
  await pool.query(`
    DROP TABLE IF EXISTS byline_analytics_rollup_state;
    DROP TABLE IF EXISTS byline_analytics_daily_country;
    DROP TABLE IF EXISTS byline_analytics_daily_referrer;
    DROP TABLE IF EXISTS byline_analytics_daily_site;
    DROP TABLE IF EXISTS byline_analytics_daily_path;
    DROP TABLE IF EXISTS byline_analytics_salt;
    DROP TABLE IF EXISTS byline_analytics_event;
    DROP TABLE IF EXISTS byline_analytics_migrations;
  `)
}

function assertTestDatabase(value: string | undefined): string {
  if (value == null) {
    throw new Error(
      'BYLINE_DB_POSTGRES_CONNECTION_STRING is not set. ' +
        'Create packages/analytics-postgres/.env.test.'
    )
  }
  const database = new URL(value).pathname.replace(/^\//u, '')
  if (!database.endsWith('_test')) {
    throw new Error(`Refusing analytics tests against "${database}"; it must end in "_test"`)
  }
  return value
}
