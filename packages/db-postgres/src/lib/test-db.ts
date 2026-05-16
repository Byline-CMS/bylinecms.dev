/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { sql } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

import * as schema from '../database/schema/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Drizzle migrations folder. Migrations (`*.sql` + `meta/_journal.json`)
 * live only under `src/` — the TypeScript build doesn't copy them into
 * `dist/`. Anchor on `src/database/migrations` from either location:
 *
 *   src/lib/test-db.ts  → ../../src/database/migrations ✓
 *   dist/lib/test-db.js → ../../src/database/migrations ✓
 *
 * `path.resolve` normalises the `../..` away, so the same string works
 * for both build modes.
 */
const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../src/database/migrations')

/**
 * Belt for the script-level braces in `common.sh`. Parses the connection
 * string and refuses to continue unless the database name ends in `_test`.
 * Called at every test-process entry point so a stray `.env` pointed at
 * `byline_dev` (or anything else) trips the guard before any DDL runs.
 */
export function assertTestDatabase(connectionString: string | undefined): string {
  if (!connectionString) {
    throw new Error('POSTGRES_CONNECTION_STRING is not set. Copy .env.test.example to .env.test.')
  }
  let dbName: string
  try {
    const url = new URL(connectionString)
    dbName = url.pathname.replace(/^\//, '')
  } catch (err) {
    throw new Error(`POSTGRES_CONNECTION_STRING is not a valid URL: ${(err as Error).message}`)
  }
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against database '${dbName}'. ` +
        `Integration tests require a database whose name ends in '_test'. ` +
        `Update POSTGRES_CONNECTION_STRING in .env.test.`
    )
  }
  return dbName
}

/**
 * Run Drizzle migrations against the configured connection. Idempotent —
 * Drizzle tracks applied migrations in `__drizzle_migrations`. Opens and
 * closes its own pool; safe to call from a vitest globalSetup or a node:test
 * bootstrap module.
 */
export async function migrateTestDatabase(connectionString: string): Promise<void> {
  assertTestDatabase(connectionString)
  const pool = new pg.Pool({ connectionString, max: 1 })
  try {
    const db = drizzle(pool, { schema })
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  } finally {
    await pool.end()
  }
}

/**
 * Wipe every user table in the `public` schema (skipping Drizzle's own
 * `__drizzle_migrations` ledger). Uses a single `TRUNCATE ... RESTART
 * IDENTITY CASCADE` so foreign-key chains, sequences, and dependent rows
 * all reset cleanly in one statement.
 *
 * Self-maintaining as the schema grows — new tables come along for the
 * ride without any code change.
 */
export async function truncateAllTables(db: NodePgDatabase<typeof schema>): Promise<void> {
  const rows = await db.execute<{ table_name: string }>(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name <> '__drizzle_migrations'
  `)
  const tables = rows.rows.map((r) => `"public"."${r.table_name}"`)
  if (tables.length === 0) return
  await db.execute(sql.raw(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`))
}

/**
 * Convenience: assert + open a short-lived pool + truncate + close. Useful
 * from a vitest setupFile (`beforeAll`) where the caller doesn't otherwise
 * need a long-lived db handle.
 */
export async function resetTestDatabase(connectionString: string): Promise<void> {
  assertTestDatabase(connectionString)
  const pool = new pg.Pool({ connectionString, max: 1 })
  try {
    const db = drizzle(pool, { schema })
    await truncateAllTables(db)
  } finally {
    await pool.end()
  }
}
