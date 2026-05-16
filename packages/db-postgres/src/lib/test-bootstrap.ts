/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Per-test-file bootstrap for node:test integration tests.
 *
 * The `tsx --env-file=.env.test --import ./src/lib/test-bootstrap.ts --test`
 * invocation runs this module once at the start of each test-file process,
 * before any test imports resolve. It:
 *
 *   1. Asserts `POSTGRES_CONNECTION_STRING` targets a `_test` database
 *      (belt; the script-level guard in `common.sh` is the braces).
 *   2. Applies Drizzle migrations (idempotent — cheap on re-run).
 *   3. Truncates all `public` tables so the file starts from a known state.
 *
 * Top-level await ensures the file's own `before()` hooks don't run until
 * the database is ready.
 */

import { assertTestDatabase, migrateTestDatabase, resetTestDatabase } from './test-db.js'

const connectionString = process.env.POSTGRES_CONNECTION_STRING
assertTestDatabase(connectionString)

await migrateTestDatabase(connectionString as string)
await resetTestDatabase(connectionString as string)
