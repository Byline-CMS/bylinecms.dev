/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { Pool } from 'pg'

import { MIGRATIONS } from './migrations-data.js'

const MIGRATION_LOCK = 1_682_231_441

export interface MigrateOptions {
  log?: (message: string) => void
}

export interface MigrateResult {
  applied: number[]
}

/** Apply pending driver-owned migrations transactionally and bundle-safely. */
export async function migrate(pool: Pool, options: MigrateOptions = {}): Promise<MigrateResult> {
  const client = await pool.connect()
  const applied: number[] = []
  let locked = false
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK])
    locked = true
    await client.query(`
      CREATE TABLE IF NOT EXISTS byline_analytics_migrations (
        version    integer     PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    const rows = await client.query<{ version: number }>(
      'SELECT version FROM byline_analytics_migrations'
    )
    const done = new Set(rows.rows.map((row) => Number(row.version)))

    for (const migration of [...MIGRATIONS].sort((left, right) => left.version - right.version)) {
      if (done.has(migration.version)) continue
      await client.query('BEGIN')
      try {
        await client.query(migration.sql)
        await client.query('INSERT INTO byline_analytics_migrations (version) VALUES ($1)', [
          migration.version,
        ])
        await client.query('COMMIT')
        applied.push(migration.version)
        options.log?.(`[analytics-postgres] applied migration ${migration.name}`)
      } catch (error) {
        await client.query('ROLLBACK')
        throw new Error(
          `[analytics-postgres] migration ${migration.name} failed: ${(error as Error).message}`,
          { cause: error }
        )
      }
    }
    return { applied }
  } finally {
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK])
    } finally {
      client.release()
    }
  }
}
