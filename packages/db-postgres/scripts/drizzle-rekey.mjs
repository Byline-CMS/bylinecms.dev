/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// Re-key a local database's Drizzle ledger after a release squash.
//
// The squash replaces the migration chain with one new `0000` migration whose
// journal timestamp is newer than anything a local database has applied, so
// `drizzle:migrate` would try to re-apply the whole baseline and fail. This
// script replaces the ledger rows in `drizzle.__drizzle_migrations` with the
// single row Drizzle expects for the new baseline (SHA-256 of the file, and the
// journal's `when`). It changes no schema and no data.
//
// Dry run by default; pass --apply to write. Refuses any database whose name
// does not end in `_dev` or `_test`. Only re-key a database that applied every
// migration being squashed. See RELEASE-INSTRUCTIONS.md, section III.
//
//   pnpm --filter @byline/db-postgres drizzle:rekey            # .env (byline_dev)
//   pnpm --filter @byline/db-postgres drizzle:rekey:test       # .env.test (byline_test)
//   pnpm --filter @byline/db-postgres drizzle:rekey -- --apply

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import pg from 'pg'

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../src/database/migrations')
const apply = process.argv.includes('--apply')

function fail(message) {
  console.error(`✗ drizzle:rekey — ${message}`)
  process.exit(1)
}

const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta/_journal.json'), 'utf8'))
if (journal.entries.length !== 1) {
  fail(
    `expected exactly one journal entry after a squash, found ${journal.entries.length}. ` +
      'Re-keying only applies to a squashed baseline.'
  )
}
const [entry] = journal.entries
const hash = createHash('sha256')
  .update(readFileSync(join(MIGRATIONS, `${entry.tag}.sql`)))
  .digest('hex')
const when = entry.when

const connectionString = process.env.BYLINE_DB_POSTGRES_CONNECTION_STRING
if (!connectionString) fail('BYLINE_DB_POSTGRES_CONNECTION_STRING is not set.')

const client = new pg.Client({ connectionString })
await client.connect()
try {
  const { rows: dbRows } = await client.query('SELECT current_database() AS name')
  const database = dbRows[0].name
  if (!database.endsWith('_dev') && !database.endsWith('_test')) {
    fail(`refusing database '${database}': only *_dev and *_test databases may be re-keyed.`)
  }

  const exists = await client.query(
    "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present"
  )
  if (!exists.rows[0].present) {
    fail(
      `'${database}' has no Drizzle ledger. A fresh database needs drizzle:migrate, not a re-key.`
    )
  }

  const { rows } = await client.query(
    'SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id'
  )
  if (rows.length === 1 && rows[0].hash === hash && Number(rows[0].created_at) === when) {
    console.log(`✓ '${database}' is already keyed to ${entry.tag}; nothing to do.`)
    process.exit(0)
  }
  if (rows.length === 0) {
    fail(`'${database}' has an empty ledger. Run drizzle:migrate instead of re-keying.`)
  }
  const newest = Math.max(...rows.map((row) => Number(row.created_at)))
  if (newest > when) {
    fail(
      `'${database}' has a ledger row newer than the baseline (${newest} > ${when}). ` +
        'It ran migrations generated after this squash; re-keying would hide them.'
    )
  }

  console.log(`Database '${database}': replacing ${rows.length} ledger row(s):`)
  for (const row of rows) console.log(`  ${row.id}  ${row.hash.slice(0, 16)}…  ${row.created_at}`)
  console.log(`with:  ${entry.tag}  ${hash.slice(0, 16)}…  ${when}`)
  console.log('This assumes the database applied every migration that was squashed.')

  if (!apply) {
    console.log('Dry run: nothing written. Re-run with --apply to re-key.')
    process.exit(0)
  }

  await client.query('BEGIN')
  try {
    await client.query('DELETE FROM drizzle.__drizzle_migrations')
    await client.query(
      'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
      [hash, when]
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  }
  console.log(`✓ '${database}' re-keyed to ${entry.tag}. Run drizzle:migrate to confirm a no-op.`)
} finally {
  await client.end()
}
