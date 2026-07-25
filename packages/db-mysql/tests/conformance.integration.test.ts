/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Runs the shared `@byline/db-conformance` storage suite against the MySQL
 * adapter — the same behavioural gate `packages/db-postgres/tests/
 * conformance.integration.test.ts` runs for the Postgres adapter.
 *
 * All 14 suites are registered as of Task 12 (the admin-store repositories
 * and `createAdminStore` hook). The staged, one-suite-per-task registration
 * that preceded this — kept CI green while the write surface (Task 9), read
 * surface (Task 10), and counters/audit (Task 11) landed incrementally — is
 * no longer needed now that every suite passes, so this collapses to a
 * single `runAdapterConformanceSuite(hooks)` call, matching db-postgres's
 * conformance entry.
 */

import type { AdminStore } from '@byline/admin'
import type { CollectionDefinition, IDbAdapter } from '@byline/core'
import { runAdapterConformanceSuite } from '@byline/db-conformance'

import { assertTestDatabase, migrateTestDatabase, resetTestDatabase } from '../src/lib/test-db.js'
import { setupTestDB, teardownTestDB } from '../src/lib/test-helper.js'
import { createAdminStore as createMysqlAdminStore } from '../src/modules/admin/admin-store.js'
import { createAuditCommands } from '../src/modules/audit/audit-commands.js'
import { createAuditQueries } from '../src/modules/audit/audit-queries.js'
import { createCounterCommands } from '../src/modules/counters/counters-commands.js'
import { classifyError } from '../src/modules/storage/classify-error.js'

function getConnectionString(): string {
  const connectionString = process.env.BYLINE_DB_MYSQL_CONNECTION_STRING
  assertTestDatabase(connectionString)
  return connectionString as string
}

runAdapterConformanceSuite({
  async createAdapter(collections: readonly CollectionDefinition[]): Promise<IDbAdapter> {
    const testDb = setupTestDB(collections as CollectionDefinition[])
    // Counters take the raw mysql2 pool (`testDb.pool`), never `dbManager` —
    // see the class docblock on `CounterCommands` for why. Audit appends
    // take `dbManager` (join the ambient transaction); audit reads take the
    // plain `db` (the pool).
    const counterCommands = createCounterCommands(testDb.pool)
    const auditCommands = createAuditCommands(testDb.dbManager)
    const auditQueries = createAuditQueries(testDb.db)

    return {
      classifyError,
      commands: {
        ...testDb.commandBuilders,
        counters: counterCommands,
        audit: auditCommands,
      },
      queries: {
        // `testDb.queryBuilders.collections` fully implements
        // `ICollectionQueries` (Task 10A).
        collections: testDb.queryBuilders.collections,
        // `testDb.queryBuilders.documents` (`DocumentQueries`) fully
        // implements `IDocumentQueries` as of Task 10B — spread directly,
        // unlike the Task 10A per-member composition this replaces.
        documents: testDb.queryBuilders.documents,
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

  async createAdminStore(): Promise<AdminStore> {
    const testDb = setupTestDB()
    return createMysqlAdminStore(testDb.db)
  },
})
