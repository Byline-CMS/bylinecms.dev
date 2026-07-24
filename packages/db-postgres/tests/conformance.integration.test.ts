/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Runs the shared `@byline/db-conformance` storage suite against the
 * Postgres adapter — the same behavioural gate a future MySQL (or any other
 * `IDbAdapter`) implementation runs via its own `ConformanceHooks`.
 *
 * `createAdapter` composes a full `IDbAdapter` (commands/queries/audit/
 * counters/withTransaction) the same way `pgAdapter()` does, but reuses the
 * singleton pool/DBManager `../src/lib/test-helper.ts` already provides so
 * connections aren't opened per suite — each of the eleven suites below
 * calls `hooks.createAdapter()` once in its own `beforeAll`, the same way
 * every one of the original per-file integration tests called `setupTestDB()`
 * once in its own `beforeAll`.
 */

import type { CollectionDefinition, IDbAdapter } from '@byline/core'
import { runAdapterConformanceSuite } from '@byline/db-conformance'

import { assertTestDatabase, migrateTestDatabase, resetTestDatabase } from '../src/lib/test-db.js'
import { setupTestDB, teardownTestDB } from '../src/lib/test-helper.js'
import { createAuditCommands } from '../src/modules/audit/audit-commands.js'
import { createAuditQueries } from '../src/modules/audit/audit-queries.js'
import { createCounterCommands } from '../src/modules/counters/counters-commands.js'

function getConnectionString(): string {
  const connectionString = process.env.BYLINE_DB_POSTGRES_CONNECTION_STRING
  assertTestDatabase(connectionString)
  return connectionString as string
}

runAdapterConformanceSuite({
  async createAdapter(collections: readonly CollectionDefinition[]): Promise<IDbAdapter> {
    const testDb = setupTestDB(collections as CollectionDefinition[])
    const counterCommands = createCounterCommands(testDb.db)
    const auditCommands = createAuditCommands(testDb.dbManager)
    const auditQueries = createAuditQueries(testDb.db)

    return {
      commands: {
        ...testDb.commandBuilders,
        counters: counterCommands,
        audit: auditCommands,
      },
      queries: {
        ...testDb.queryBuilders,
        audit: auditQueries,
      },
      withTransaction: (fn) => testDb.txManager.withTransaction(fn),
    }
  },

  async migrate(): Promise<void> {
    await migrateTestDatabase(getConnectionString())
  },

  async truncate(): Promise<void> {
    await resetTestDatabase(getConnectionString())
  },

  async teardown(): Promise<void> {
    await teardownTestDB()
  },
})
