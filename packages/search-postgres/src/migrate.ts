/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Migration runner — the driver owns its schema. Applies the numbered
 * migrations that haven't run yet, recording each in its own
 * `byline_search_migrations` bookkeeping table (separate from the host's
 * migration stream). Idempotent and transactional per migration.
 *
 * The SQL is embedded (`./migrations-data`) so the runner is **bundle-safe** —
 * a production server bundle (Nitro / rollup) inlines this package and rewrites
 * `import.meta.url`, which would break reading the `.sql` files from disk at
 * runtime. The numbered `.sql` files remain the source of truth and still ship
 * for the by-hand path (`psql -f migrations/0001_init.sql`) in locked-down
 * environments; `migrate(pool)` / `autoMigrate` are the convenience paths.
 */

import type { Pool } from 'pg'

import { MIGRATIONS } from './migrations-data.js'

export interface MigrateOptions {
  /** Optional sink for progress lines (e.g. the host logger). */
  log?: (message: string) => void
}

export interface MigrateResult {
  /** Versions applied during this run (empty when already up to date). */
  applied: number[]
}

/**
 * Apply any pending search-index migrations. Safe to call repeatedly (and at
 * boot via `autoMigrate`) — already-applied versions are skipped.
 */
export async function migrate(pool: Pool, options: MigrateOptions = {}): Promise<MigrateResult> {
  const log = options.log ?? (() => {})

  await pool.query(`
    CREATE TABLE IF NOT EXISTS byline_search_migrations (
      version    integer     PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  const appliedRows = await pool.query<{ version: number }>(
    'SELECT version FROM byline_search_migrations'
  )
  const done = new Set(appliedRows.rows.map((r) => Number(r.version)))

  const pending = loadMigrations().filter((m) => !done.has(m.version))
  const applied: number[] = []

  for (const migration of pending) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(migration.sql)
      await client.query('INSERT INTO byline_search_migrations (version) VALUES ($1)', [
        migration.version,
      ])
      await client.query('COMMIT')
      applied.push(migration.version)
      log(`[search-postgres] applied migration ${migration.name}`)
    } catch (error) {
      await client.query('ROLLBACK')
      throw new Error(
        `[search-postgres] migration ${migration.name} failed: ${(error as Error).message}`,
        { cause: error }
      )
    } finally {
      client.release()
    }
  }

  return { applied }
}

/** The embedded migrations, sorted by version ascending. */
function loadMigrations(): typeof MIGRATIONS {
  return [...MIGRATIONS].sort((a, b) => a.version - b.version)
}
