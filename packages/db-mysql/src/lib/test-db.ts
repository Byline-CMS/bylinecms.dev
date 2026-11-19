/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import mysql from 'mysql2/promise'

import { loadBaseline, prefix } from '../migrations/assets.js'
import { rows } from '../migrations/catalog.js'
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

/** Install the frozen adapter baseline on an explicitly isolated target. */
export async function migrateTestDatabase(connectionString: string): Promise<void> {
  assertTestDatabase(connectionString)
  await installCoreStorage(connectionString)
}

/** Clear the manifest's content tables on one physical session. */
export async function resetTestDatabase(connectionString: string): Promise<void> {
  const database = assertTestDatabase(connectionString)
  const { stages } = loadBaseline()
  const tables = new Set(
    [...prefix(stages, stages.length)]
      .filter(([, lines]) => lines.some((line) => line.startsWith('CREATE TABLE ')))
      .map(([name]) => name)
  )
  const connection = await mysql.createConnection(connectionString)
  try {
    const references = await rows(
      connection,
      `SELECT TABLE_SCHEMA AS db,TABLE_NAME AS child,REFERENCED_TABLE_NAME AS parent
      FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA=DATABASE()`
    )
    for (const ref of references)
      if (tables.has(ref.parent) && (ref.db !== database || !tables.has(ref.child)))
        throw new Error(`Refusing to truncate core tables referenced by ${ref.db}.${ref.child}`)
    await connection.query('SET FOREIGN_KEY_CHECKS=0')
    try {
      for (const table of tables) await connection.query(`TRUNCATE TABLE ${mysql.escapeId(table)}`)
    } finally {
      await connection.query('SET FOREIGN_KEY_CHECKS=1')
    }
  } finally {
    await connection.end()
  }
}
