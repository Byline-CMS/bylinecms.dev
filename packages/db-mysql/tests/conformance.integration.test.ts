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
 * Suites are registered here one at a time, as each lands its own task
 * (`@byline/db-conformance`'s index exports every suite by name so an
 * adapter mid-port can register only the ones it currently passes without
 * turning the rest of `pnpm test:integration` — and CI, which runs it at
 * the repo root on every push — red for the whole of the port):
 *
 *   - Task 10A: `versioningSuite`, `fieldTypesSuite`.
 *   - Task 10B: `documentPathsSuite`, `documentTreeSuite`, `transactionsSuite`,
 *     `deleteLocaleSuite`, `documentAvailableLocalesSuite`,
 *     `systemFieldsDirectWriteSuite`, `restoreSuite`, `localeFallbackSuite`
 *     — the full storage surface minus tree-audit atomicity, 10 of the 14
 *     total suites.
 *   - Task 11 (this file): `countersSuite`, `auditSuite`, and
 *     `documentTreeAuditSuite` — `commands.counters.*` and
 *     `commands.audit.*` / `queries.audit.*` are real as of this task, so
 *     the tree-mutation lifecycle functions
 *     (`placeTreeNode`/`removeFromTree`/`promoteChildrenAndRemove`) that
 *     `documentTreeAuditSuite` exercises can now append to and read back
 *     from a working audit log. 13 of the 14 suites.
 *
 * `adminStoreSuite` stays unregistered — the admin-store repositories are
 * Task 12.
 *
 * TODO(Task 13): once every suite passes, replace the list below with a
 * single `runAdapterConformanceSuite(hooks)` call — see db-postgres's
 * conformance entry for the target shape.
 */

import type { CollectionDefinition, IDbAdapter } from '@byline/core'
import {
  auditSuite,
  type ConformanceHooks,
  countersSuite,
  deleteLocaleSuite,
  documentAvailableLocalesSuite,
  documentPathsSuite,
  documentTreeAuditSuite,
  documentTreeSuite,
  fieldTypesSuite,
  localeFallbackSuite,
  restoreSuite,
  systemFieldsDirectWriteSuite,
  transactionsSuite,
  versioningSuite,
} from '@byline/db-conformance'

import { assertTestDatabase, migrateTestDatabase, resetTestDatabase } from '../src/lib/test-db.js'
import { setupTestDB, teardownTestDB } from '../src/lib/test-helper.js'
import { createAuditCommands } from '../src/modules/audit/audit-commands.js'
import { createAuditQueries } from '../src/modules/audit/audit-queries.js'
import { createCounterCommands } from '../src/modules/counters/counters-commands.js'
import { classifyError } from '../src/modules/storage/classify-error.js'

function getConnectionString(): string {
  const connectionString = process.env.BYLINE_DB_MYSQL_CONNECTION_STRING
  assertTestDatabase(connectionString)
  return connectionString as string
}

const hooks: ConformanceHooks = {
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

  // `createAdminStore` intentionally omitted — the admin-store repositories
  // are Task 12. The admin-store conformance suites are not registered
  // below, so this is a correct omission rather than a gap: no `describe`/
  // `it` blocks exist for them, so they never show up as skipped.
}

versioningSuite(hooks)
fieldTypesSuite(hooks)
documentPathsSuite(hooks)
documentTreeSuite(hooks)
documentTreeAuditSuite(hooks)
transactionsSuite(hooks)
deleteLocaleSuite(hooks)
documentAvailableLocalesSuite(hooks)
systemFieldsDirectWriteSuite(hooks)
restoreSuite(hooks)
localeFallbackSuite(hooks)
countersSuite(hooks)
auditSuite(hooks)
