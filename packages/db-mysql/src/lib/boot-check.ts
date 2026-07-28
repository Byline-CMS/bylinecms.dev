/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Boot-time engine check for the MySQL adapter. `mysqlAdapter` runs this
 * lazily against the first connection the pool hands out (see
 * `src/index.ts`) so a too-old server or a MariaDB instance fails fast at
 * `initBylineCore()` boot rather than surfacing as an obscure SQL error the
 * first time the storage layer emits a LATERAL join (Task 10+).
 */

// Keep this adapter floor synchronized with the pre-install check in
// `packages/cli/src/lib/database/mysql.ts`; the CLI contract test compares
// the two constants without adding a runtime dependency on this package.
const MIN = { major: 8, minor: 0, patch: 14 }

const unsupportedEngineError = (reported: string): Error =>
  new Error(
    `@byline/db-mysql requires MySQL ${MIN.major}.${MIN.minor}.${MIN.patch}+ (LATERAL joins); server reports ${reported}. MariaDB is not supported.`
  )

/**
 * Assert the connected server is MySQL (not MariaDB) at or above the
 * supported floor. `query` is injected so this is unit-testable without a
 * live server — the adapter passes a thin wrapper around the pool's
 * `SELECT VERSION()` round trip.
 */
export async function assertMySqlVersion(
  query: (sql: string) => Promise<Array<{ v: string }>>
): Promise<void> {
  const rows = await query('SELECT VERSION() AS v')
  const v = rows?.[0]?.v

  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(
      "@byline/db-mysql: could not determine the MySQL server version — 'SELECT VERSION()' returned no usable result."
    )
  }

  // MariaDB reports version strings that satisfy the numeric floor below
  // (it commonly claims a 10.x/11.x series, sometimes fronted by the
  // legacy `5.5.5-` replication-handshake prefix), so it must be rejected
  // explicitly before the numeric comparison, not merely by chance.
  if (/mariadb/i.test(v)) {
    throw unsupportedEngineError(v)
  }

  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/)
  const [major = 0, minor = 0, patch = 0] = m ? m.slice(1).map(Number) : []
  const ok =
    major > MIN.major ||
    (major === MIN.major && (minor > MIN.minor || (minor === MIN.minor && patch >= MIN.patch)))

  if (!ok) {
    throw unsupportedEngineError(v)
  }
}
