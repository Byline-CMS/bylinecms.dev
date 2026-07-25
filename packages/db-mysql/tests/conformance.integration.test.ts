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
 *   - Task 10A: `versioningSuite`, `fieldTypesSuite` (this file).
 *
 * TODO(Task 13): once every suite passes, replace the list below with a
 * single `runAdapterConformanceSuite(hooks)` call — see db-postgres's
 * conformance entry for the target shape.
 */

import type { CollectionDefinition, IDbAdapter } from '@byline/core'
import { type ConformanceHooks, fieldTypesSuite, versioningSuite } from '@byline/db-conformance'

import { assertTestDatabase, migrateTestDatabase, resetTestDatabase } from '../src/lib/test-db.js'
import { setupTestDB, teardownTestDB } from '../src/lib/test-helper.js'
import { classifyError } from '../src/modules/storage/classify-error.js'

function getConnectionString(): string {
  const connectionString = process.env.BYLINE_DB_MYSQL_CONNECTION_STRING
  assertTestDatabase(connectionString)
  return connectionString as string
}

const hooks: ConformanceHooks = {
  async createAdapter(collections: readonly CollectionDefinition[]): Promise<IDbAdapter> {
    const testDb = setupTestDB(collections as CollectionDefinition[])

    return {
      classifyError,
      commands: {
        ...testDb.commandBuilders,
        counters: {
          ensureCounterGroup: notImplemented('commands.counters.ensureCounterGroup'),
          nextCounterValue: notImplemented('commands.counters.nextCounterValue'),
          nextScopedCounterValue: notImplemented('commands.counters.nextScopedCounterValue'),
        },
        audit: {
          append: notImplemented('commands.audit.append'),
        },
      },
      queries: {
        // `testDb.queryBuilders.collections` fully implements
        // `ICollectionQueries` (Task 10A).
        collections: testDb.queryBuilders.collections,
        // `testDb.queryBuilders.documents` (`DocumentQueries`) implements
        // only the reconstruction path as of Task 10A — mirror
        // `src/index.ts`'s per-member composition rather than spreading,
        // since `DocumentQueries` does not (yet) satisfy the full
        // `IDocumentQueries` shape this object must return.
        documents: {
          getDocumentSystemFieldsForUpdate: notImplemented(
            'queries.documents.getDocumentSystemFieldsForUpdate'
          ),
          getDocumentById: (params) => testDb.queryBuilders.documents.getDocumentById(params),
          getCurrentVersionMetadata: notImplemented('queries.documents.getCurrentVersionMetadata'),
          getCurrentPath: notImplemented('queries.documents.getCurrentPath'),
          getDocumentByPath: notImplemented('queries.documents.getDocumentByPath'),
          getDocumentByVersion: (params) =>
            testDb.queryBuilders.documents.getDocumentByVersion(params),
          getDocumentsByVersionIds: notImplemented('queries.documents.getDocumentsByVersionIds'),
          getDocumentsByDocumentIds: notImplemented('queries.documents.getDocumentsByDocumentIds'),
          getDocumentHistory: (params) => testDb.queryBuilders.documents.getDocumentHistory(params),
          getPublishedVersion: notImplemented('queries.documents.getPublishedVersion'),
          getPublishedDocumentIds: notImplemented('queries.documents.getPublishedDocumentIds'),
          getDocumentCountsByStatus: notImplemented('queries.documents.getDocumentCountsByStatus'),
          findDocuments: (params) => testDb.queryBuilders.documents.findDocuments(params),
          getLastOrderKey: notImplemented('queries.documents.getLastOrderKey'),
          getNeighborOrderKeys: notImplemented('queries.documents.getNeighborOrderKeys'),
          getCanonicalDocumentOrder: notImplemented('queries.documents.getCanonicalDocumentOrder'),
          getTreeAncestors: notImplemented('queries.documents.getTreeAncestors'),
          getTreeChildren: notImplemented('queries.documents.getTreeChildren'),
          getTreeParent: notImplemented('queries.documents.getTreeParent'),
          getTreeSubtree: notImplemented('queries.documents.getTreeSubtree'),
        },
        audit: {
          getDocumentAuditLog: notImplemented('queries.audit.getDocumentAuditLog'),
          findAuditLog: notImplemented('queries.audit.findAuditLog'),
        },
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

/**
 * Build a stub matching one not-yet-implemented `IDbAdapter` member's exact
 * call signature. Neither of the two suites registered below (`versioning`,
 * `field-types`) exercises counters, audit, or the admin store — those are
 * Tasks 11/12. Throwing keeps that honest rather than silently no-op-ing.
 */
function notImplemented<T>(member: string): T {
  return (() => {
    throw new Error(`@byline/db-mysql: ${member} is not implemented yet`)
  }) as unknown as T
}

versioningSuite(hooks)
fieldTypesSuite(hooks)
