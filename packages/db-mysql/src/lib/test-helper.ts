/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition } from '@byline/core'
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2'
import mysql from 'mysql2/promise'

import * as schema from '../database/schema/index.js'
import { createCommandBuilders } from '../modules/storage/storage-commands.js'
import { DBManagerImpl, TXManagerImpl } from './db-manager.js'
import { assertTestDatabase } from './test-db.js'

let pool: mysql.Pool
let db: MySql2Database<typeof schema>
let dbManager: DBManagerImpl
let txManager: TXManagerImpl
let commandBuilders: ReturnType<typeof createCommandBuilders>

/**
 * Mirrors `packages/db-postgres/src/lib/test-helper.ts`. `queryBuilders` is
 * intentionally not wired here yet — `storage-queries.ts` is Task 10; the
 * conformance suites this package currently registers
 * (`tests/conformance.integration.test.ts`) only exercise the command/write
 * surface plus the narrow read slice Task 9A ported alongside it.
 */
export function setupTestDB(_collections: CollectionDefinition[] = []) {
  if (!pool) {
    assertTestDatabase(process.env.BYLINE_DB_MYSQL_CONNECTION_STRING)
    pool = mysql.createPool({
      uri: process.env.BYLINE_DB_MYSQL_CONNECTION_STRING,
      // Mirrors the pg test helper: tests are serial and run one query at a
      // time, so a small pool per test file is sufficient.
      connectionLimit: 4,
      timezone: 'Z',
      decimalNumbers: false,
    })
  }

  if (!db) {
    db = drizzle(pool, { schema, mode: 'default' })
  }

  if (!dbManager) {
    dbManager = new DBManagerImpl({ dbPool: db })
    txManager = new TXManagerImpl({ db: dbManager })
  }

  if (!commandBuilders) {
    commandBuilders = createCommandBuilders(dbManager, 'en')
  }

  return { pool, db, dbManager, txManager, commandBuilders }
}

export async function teardownTestDB() {
  if (pool) {
    await pool.end()
    pool = undefined as any
    db = undefined as any
    dbManager = undefined as any
    txManager = undefined as any
    commandBuilders = undefined as any
  }
}
