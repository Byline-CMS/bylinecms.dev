/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2'
import { migrate } from 'drizzle-orm/mysql2/migrator'
import mysql from 'mysql2/promise'

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
 * for both build modes. Mirrors `packages/db-postgres/src/lib/test-db.ts`.
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
    throw new Error(
      'BYLINE_DB_MYSQL_CONNECTION_STRING is not set. Copy .env.test.example to .env.test.'
    )
  }
  let dbName: string
  try {
    const url = new URL(connectionString)
    dbName = url.pathname.replace(/^\//, '')
  } catch (err) {
    throw new Error(
      `BYLINE_DB_MYSQL_CONNECTION_STRING is not a valid URL: ${(err as Error).message}`
    )
  }
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against database '${dbName}'. ` +
        `Integration tests require a database whose name ends in '_test'. ` +
        `Update BYLINE_DB_MYSQL_CONNECTION_STRING in .env.test.`
    )
  }
  return dbName
}

/**
 * Run Drizzle migrations against the configured connection. Idempotent —
 * Drizzle tracks applied migrations in `__drizzle_migrations`. Opens and
 * closes its own pool; safe to call from a vitest globalSetup.
 */
export async function migrateTestDatabase(connectionString: string): Promise<void> {
  assertTestDatabase(connectionString)
  const pool = mysql.createPool({ uri: connectionString, connectionLimit: 1, timezone: 'Z' })
  try {
    const db = drizzle(pool, { schema, mode: 'default' })
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  } finally {
    await pool.end()
  }
}

/**
 * Wipe every user table so each test file starts from a known state. MySQL
 * has no `TRUNCATE ... CASCADE` — foreign keys must be disabled around the
 * truncates instead, and restored afterwards (including on failure), or a
 * later test file inherits a permanently-disabled FK session setting.
 * Skips Drizzle's own `__drizzle_migrations` ledger. Self-maintaining as the
 * schema grows — new tables come along for the ride without any code change.
 */
export async function truncateAllTables(db: MySql2Database<typeof schema>): Promise<void> {
  const [rows] = await db.execute<{ table_name: string }>(`
    SELECT TABLE_NAME AS table_name FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_type = 'BASE TABLE'
      AND table_name <> '__drizzle_migrations'
  `)
  const tables = (rows as unknown as { table_name: string }[]).map((r) => `\`${r.table_name}\``)
  if (tables.length === 0) return

  await db.execute('SET FOREIGN_KEY_CHECKS = 0')
  try {
    for (const table of tables) {
      await db.execute(`TRUNCATE TABLE ${table}`)
    }
  } finally {
    await db.execute('SET FOREIGN_KEY_CHECKS = 1')
  }
}

/**
 * Convenience: assert + open a short-lived pool + truncate + close. Useful
 * from a vitest setupFile (`beforeAll`) where the caller doesn't otherwise
 * need a long-lived db handle.
 */
export async function resetTestDatabase(connectionString: string): Promise<void> {
  assertTestDatabase(connectionString)
  const pool = mysql.createPool({ uri: connectionString, connectionLimit: 1, timezone: 'Z' })
  try {
    const db = drizzle(pool, { schema, mode: 'default' })
    await truncateAllTables(db)
  } finally {
    await pool.end()
  }
}
