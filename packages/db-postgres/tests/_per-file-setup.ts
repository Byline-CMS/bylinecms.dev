/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { config as loadEnv } from 'dotenv'
import { beforeAll } from 'vitest'

import { resetTestDatabase } from '../src/lib/test-db.js'

loadEnv({ path: '.env.test' })

/**
 * Vitest `setupFiles`: runs once per test file. The `beforeAll` truncates
 * every user table in `public` (sequences and foreign keys reset via
 * RESTART IDENTITY CASCADE) so each file starts from a known state — a
 * crashed test in a prior file can't leak rows into the next.
 */
beforeAll(async () => {
  const connectionString = process.env.POSTGRES_CONNECTION_STRING
  if (!connectionString) {
    throw new Error('POSTGRES_CONNECTION_STRING is not set')
  }
  await resetTestDatabase(connectionString)
})
