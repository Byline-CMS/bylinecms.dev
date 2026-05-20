/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { assertTestDatabase, migrateTestDatabase } from '@byline/db-postgres/testing'
import { config as loadEnv } from 'dotenv'

// Integration mode reads `.env.test` rather than `.env` so the test suite
// never reuses the developer's `byline_dev` connection string. `globalSetup`
// runs in the host vitest process; setupFiles run in the test workers, so
// both load env explicitly.
loadEnv({ path: '.env.test' })

/**
 * Vitest `globalSetup`: runs once per `vitest run` (before any test file).
 * Asserts the configured connection points at a `_test` database and
 * applies the full Drizzle migration set. Drizzle's migrator is
 * idempotent, so re-running the suite is cheap.
 */
export default async function setup() {
  const connectionString = process.env.BYLINE_DB_POSTGRES_CONNECTION_STRING
  assertTestDatabase(connectionString)
  await migrateTestDatabase(connectionString as string)
}
