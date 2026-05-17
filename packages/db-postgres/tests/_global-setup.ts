/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { config as loadEnv } from 'dotenv'

import { assertTestDatabase, migrateTestDatabase } from '../src/lib/test-db.js'

/**
 * Vitest `globalSetup`: runs once per `vitest run` before any test file
 * loads. Asserts the configured connection points at a `_test` database
 * and applies the full Drizzle migration set. Drizzle's migrator is
 * idempotent, so re-running the suite is cheap.
 */
export default async function setup() {
  loadEnv({ path: '.env.test' })

  const connectionString = process.env.POSTGRES_CONNECTION_STRING
  assertTestDatabase(connectionString)
  await migrateTestDatabase(connectionString as string)
}
