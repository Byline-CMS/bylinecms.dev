/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { sql } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'

import * as schema from '../database/schema/index.js'
import { loadStorageSteps } from '../migrations/assets.js'
import { installCoreStorage } from '../migrations/index.js'

/**
 * Belt for the script-level braces in `common.sh`. Parses the connection
 * string and refuses to continue unless the database name ends in `_test`.
 * Called at every test-process entry point so a stray `.env` pointed at
 * `byline_dev` (or anything else) trips the guard before any DDL runs.
 */
export function assertTestDatabase(connectionString: string | undefined): string {
  if (!connectionString) {
    throw new Error(
      'BYLINE_DB_POSTGRES_CONNECTION_STRING is not set. Copy .env.test.example to .env.test.'
    )
  }
  let dbName: string
  try {
    const url = new URL(connectionString)
    dbName = url.pathname.replace(/^\//, '')
  } catch (err) {
    throw new Error(
      `BYLINE_DB_POSTGRES_CONNECTION_STRING is not a valid URL: ${(err as Error).message}`
    )
  }
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against database '${dbName}'. ` +
        `Integration tests require a database whose name ends in '_test'. ` +
        `Update BYLINE_DB_POSTGRES_CONNECTION_STRING in .env.test.`
    )
  }
  return dbName
}

/** Set up a repository test database through the published core installation path. */
export async function migrateTestDatabase(connectionString: string): Promise<void> {
  const name = assertTestDatabase(connectionString)
  const client = new pg.Client({ connectionString })
  try {
    await client.connect()
    const target = await client.query(
      "SELECT current_database() AS db, to_regclass('public.byline_documents') IS NULL AS fresh"
    )
    if (target.rows[0].db !== name)
      throw new Error('Connected database differs from guarded test target')
    if (target.rows[0].fresh) await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')
  } finally {
    await client.end()
  }
  try {
    await installCoreStorage(connectionString)
  } catch (cause) {
    throw new Error(
      `Cannot initialize test database ${name}. For a disposable legacy test database, explicitly rebuild with pnpm db:init:test. ${cause instanceof Error ? cause.message : cause}`,
      { cause }
    )
  }
}

/** Truncate only core content tables. An external FK must never cascade into host data. */
export async function truncateAllTables(db: NodePgDatabase<typeof schema>): Promise<void> {
  const names = loadStorageSteps().flatMap((step) => step.relations.r ?? [])
  const tables = names.map((name) => sql`public.${sql.identifier(name)}`)
  await db.execute(sql`TRUNCATE ${sql.join(tables, sql.raw(', '))} RESTART IDENTITY`)
}

/**
 * Convenience: assert + open a short-lived pool + truncate + close. Useful
 * from a vitest setupFile (`beforeAll`) where the caller doesn't otherwise
 * need a long-lived db handle.
 */
export async function resetTestDatabase(connectionString: string): Promise<void> {
  const name = assertTestDatabase(connectionString)
  const pool = new pg.Pool({ connectionString, max: 1 })
  try {
    const db = drizzle(pool, { schema })
    const target = await db.execute<{ name: string }>(sql`SELECT current_database() AS name`)
    if (target.rows[0]?.name !== name)
      throw new Error('Connected database differs from guarded test target')
    await truncateAllTables(db)
  } finally {
    await pool.end()
  }
}
