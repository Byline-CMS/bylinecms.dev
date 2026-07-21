/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Contract test for the hand-written `sql/` upgrade scripts.
 *
 * Those scripts are the Drizzle-independent production upgrade path and are
 * run by hand via `psql -f` — possibly as a superuser. A table created by a
 * superuser is owned by that superuser, and the application's DB role then
 * gets "permission denied". Every script that creates a table must therefore
 * end with the ownership guard that reassigns objects back to the database
 * owner (the app role). The guard already drifted once — 0005 shipped without
 * it — so this test makes the requirement structural instead of a convention
 * someone has to remember. See sql/README.md.
 *
 * The Drizzle stream (`drizzle:migrate`) and `@byline/search-postgres` run
 * over a connection pool as the app role, so their objects are owned correctly
 * by construction — this guard is a `sql/`-only concern.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'sql')
const OWNERSHIP_GUARD_MARKER = '-- byline:ownership-guard'
const REASSIGN_STATEMENT = 'ALTER TABLE public.%I OWNER TO %I'

function sqlFiles(): string[] {
  return readdirSync(SQL_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
}

describe('sql/ migration ownership guard', () => {
  const files = sqlFiles()

  it('finds the hand-written migration scripts (fails loudly if the dir moves)', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    const body = readFileSync(join(SQL_DIR, file), 'utf8')
    // Only scripts that create a table can leave a mis-owned object behind.
    if (!/create\s+table/i.test(body)) continue

    describe(file, () => {
      it('carries the ownership-guard marker', () => {
        expect(body).toContain(OWNERSHIP_GUARD_MARKER)
      })

      it('reassigns object ownership to the database owner', () => {
        // Guards against a marker comment with no actual reassignment block.
        expect(body).toContain(REASSIGN_STATEMENT)
      })
    })
  }
})
