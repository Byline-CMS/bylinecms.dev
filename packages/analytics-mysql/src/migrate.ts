/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { Pool, RowDataPacket } from 'mysql2/promise'

import { MIGRATIONS } from './migrations-data.js'

const MIGRATION_LOCK = 'byline-analytics-mysql-migrations'

interface LockRow extends RowDataPacket {
  acquired: number | null
}

interface VersionRow extends RowDataPacket {
  version: number
}

export interface MigrateOptions {
  log?: (message: string) => void
}

export interface MigrateResult {
  applied: number[]
}

/** Apply pending driver-owned migrations under a MySQL advisory lock. */
export async function migrate(pool: Pool, options: MigrateOptions = {}): Promise<MigrateResult> {
  const connection = await pool.getConnection()
  try {
    const [lockRows] = await connection.query<LockRow[]>('SELECT GET_LOCK(?, 30) AS acquired', [
      MIGRATION_LOCK,
    ])
    if (lockRows[0]?.acquired !== 1) {
      throw new Error('[analytics-mysql] timed out waiting for the migration lock')
    }
    await connection.query(`
      CREATE TABLE IF NOT EXISTS byline_analytics_migrations (
        version    int         NOT NULL,
        applied_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (version)
      ) ENGINE=InnoDB
    `)
    const [rows] = await connection.query<VersionRow[]>(
      'SELECT version FROM byline_analytics_migrations'
    )
    const done = new Set(rows.map((row) => Number(row.version)))
    const applied: number[] = []
    for (const migration of [...MIGRATIONS].sort((left, right) => left.version - right.version)) {
      if (done.has(migration.version)) continue
      try {
        for (const statement of splitStatements(migration.sql)) {
          await connection.query(statement)
        }
        await connection.query('INSERT INTO byline_analytics_migrations (version) VALUES (?)', [
          migration.version,
        ])
        applied.push(migration.version)
        options.log?.(`[analytics-mysql] applied migration ${migration.name}`)
      } catch (error) {
        throw new Error(
          `[analytics-mysql] migration ${migration.name} failed: ${(error as Error).message}`,
          { cause: error }
        )
      }
    }
    return { applied }
  } finally {
    try {
      await connection.query('SELECT RELEASE_LOCK(?)', [MIGRATION_LOCK])
    } finally {
      connection.release()
    }
  }
}

function splitStatements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
}
