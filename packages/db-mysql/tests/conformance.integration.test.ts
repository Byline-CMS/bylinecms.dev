/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { sql } from 'drizzle-orm'
import { vi } from 'vitest'

import { createReadSnapshot } from '../src/modules/storage/read-snapshot.js'
import { DocumentQueries } from '../src/modules/storage/storage-queries.js'
/**
 * Runs the shared `@byline/db-conformance` storage suite against the MySQL
 * adapter — the same behavioural gate `packages/db-postgres/tests/
 * conformance.integration.test.ts` runs for the Postgres adapter.
 *
 * The full suite is registered, including the admin repositories and the
 * recurring-task scheduler store. The staged, one-suite-per-task registration
 * used while the adapter was being built is no longer needed, so this matches
 * db-postgres's single `runAdapterConformanceSuite(hooks)` entry.
 */

import type { AdminStore } from '@byline/admin'
import type { CollectionDefinition, IDbAdapter, ISchedulerStore } from '@byline/core'
import { runAdapterConformanceSuite } from '@byline/db-conformance'
import { eq } from 'drizzle-orm'

import { documents } from '../src/database/schema/index.js'
import { assertTestDatabase, migrateTestDatabase, resetTestDatabase } from '../src/lib/test-db.js'
import { setupTestDB, teardownTestDB } from '../src/lib/test-helper.js'
import { createAdminStore as createMysqlAdminStore } from '../src/modules/admin/admin-store.js'
import { createAuditCommands } from '../src/modules/audit/audit-commands.js'
import { createAuditQueries } from '../src/modules/audit/audit-queries.js'
import { createCounterCommands } from '../src/modules/counters/counters-commands.js'
import { createSchedulerStore } from '../src/modules/scheduler/scheduler-store.js'
import { classifyError } from '../src/modules/storage/classify-error.js'
import { DocumentRevisions } from '../src/modules/storage/document-revisions.js'
import { SingletonCommands, SingletonQueries } from '../src/modules/storage/singletons.js'

function getConnectionString(): string {
  const connectionString = process.env.BYLINE_DB_MYSQL_CONNECTION_STRING
  assertTestDatabase(connectionString)
  return connectionString as string
}

runAdapterConformanceSuite({
  async withSourceReadBarrier(writer, read) {
    // Private reconstruction boundary is interposed only in this serial test harness.
    const prototype = DocumentQueries.prototype as unknown as {
      getAllFieldValues: (...args: unknown[]) => Promise<unknown>
    }
    const original = prototype.getAllFieldValues
    const spy = vi.spyOn(prototype, 'getAllFieldValues').mockImplementationOnce(async function (
      ...args
    ) {
      await writer()
      return original.apply(this, args)
    })
    try {
      return await read()
    } finally {
      spy.mockRestore()
    }
  },
  async createAdapter(collections: readonly CollectionDefinition[]): Promise<IDbAdapter> {
    const testDb = setupTestDB(collections as CollectionDefinition[])
    // Counters take the raw mysql2 pool (`testDb.pool`), never `dbManager` —
    // see the class docblock on `CounterCommands` for why. Audit appends
    // take `dbManager` (join the ambient transaction); audit reads take the
    // plain `db` (the pool).
    const counterCommands = createCounterCommands(testDb.pool)
    const auditCommands = createAuditCommands(testDb.dbManager)
    const auditQueries = createAuditQueries(testDb.db)
    const singletonCommands = new SingletonCommands(testDb.dbManager)
    const singletonQueries = new SingletonQueries(testDb.dbManager)

    return {
      classifyError,
      commands: {
        ...testDb.commandBuilders,
        counters: counterCommands,
        audit: auditCommands,
        singletons: singletonCommands,
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
        singletons: singletonQueries,
      },
      withTransaction: (fn) => testDb.txManager.withTransaction(fn),
      withReadSnapshot: createReadSnapshot(testDb.db, collections, 'en'),
      revisions: new DocumentRevisions(testDb.dbManager),
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

  async createSchedulerStore(): Promise<ISchedulerStore> {
    const testDb = setupTestDB([])
    return createSchedulerStore(testDb.db)
  },

  async observeSchedulerContention<T>(operation: () => Promise<T>) {
    const { pool } = setupTestDB([])
    let activeConnections = 0
    let maxConcurrentConnections = 0

    const onAcquire = () => {
      activeConnections++
      maxConcurrentConnections = Math.max(maxConcurrentConnections, activeConnections)
    }
    const onRelease = () => {
      activeConnections--
    }

    pool.on('acquire', onAcquire)
    pool.on('release', onRelease)
    try {
      const result = await operation()
      return { result, maxConcurrentConnections }
    } finally {
      pool.off('acquire', onAcquire)
      pool.off('release', onRelease)
    }
  },

  async observePublishScheduleContention<T>(operation: () => Promise<T>) {
    const { pool } = setupTestDB([])
    let activeConnections = 0
    let maxConcurrentConnections = 0

    const onAcquire = () => {
      activeConnections++
      maxConcurrentConnections = Math.max(maxConcurrentConnections, activeConnections)
    }
    const onRelease = () => {
      activeConnections--
    }

    pool.on('acquire', onAcquire)
    pool.on('release', onRelease)
    try {
      const result = await operation()
      return { result, maxConcurrentConnections }
    } finally {
      pool.off('acquire', onAcquire)
      pool.off('release', onRelease)
    }
  },

  async observeRevisionContention<T>(
    operation: (waitForTwoConnections: () => Promise<void>) => Promise<T>
  ) {
    const { pool } = setupTestDB([])
    let activeConnections = 0
    let maxConcurrentConnections = 0
    let signalTwoConnections!: () => void
    const twoConnections = new Promise<void>((resolve) => {
      signalTwoConnections = resolve
    })
    const onAcquire = () => {
      activeConnections++
      maxConcurrentConnections = Math.max(maxConcurrentConnections, activeConnections)
      if (activeConnections >= 2) signalTwoConnections()
    }
    const onRelease = () => {
      activeConnections--
    }

    pool.on('acquire', onAcquire)
    pool.on('release', onRelease)
    try {
      const result = await operation(() => twoConnections)
      return { result, maxConcurrentConnections }
    } finally {
      pool.off('acquire', onAcquire)
      pool.off('release', onRelease)
    }
  },
  revisionTestTools: {
    async withShortLockWait(work) {
      const executor = setupTestDB([]).dbManager.get()
      const [rows] = await executor.execute(
        sql`SELECT @@SESSION.innodb_lock_wait_timeout AS timeout`
      )
      const timeout = Number((rows as Array<{ timeout: number }>)[0]?.timeout)
      if (!Number.isInteger(timeout)) throw new Error('Missing original lock timeout')
      await executor.execute(sql`SET SESSION innodb_lock_wait_timeout = 1`)
      try {
        return await work()
      } finally {
        await executor.execute(sql`SET SESSION innodb_lock_wait_timeout = ${timeout}`)
      }
    },
    async makeScheduleDue(documentId) {
      await setupTestDB([]).db.execute(
        sql`UPDATE byline_document_publish_schedules SET publish_at = ${new Date('2020-01-01T00:00:00Z')}, next_attempt_at = ${new Date('2020-01-01T00:00:00Z')} WHERE document_id = ${documentId}`
      )
    },
    async setRevision(documentId, revision) {
      await setupTestDB([])
        .db.update(documents)
        .set({ revision })
        .where(eq(documents.id, documentId))
    },
    async readRevision(documentId) {
      const [row] = await setupTestDB([])
        .db.select({ revision: documents.revision })
        .from(documents)
        .where(eq(documents.id, documentId))
      return row?.revision
    },
  },
  async observeSingletonContention<T>(
    operation: (waitForTwoConnections: () => Promise<void>) => Promise<T>
  ) {
    const { pool } = setupTestDB([])
    let activeConnections = 0
    let maxConcurrentConnections = 0
    let signalTwoConnections!: () => void
    const twoConnections = new Promise<void>((resolve) => {
      signalTwoConnections = resolve
    })
    const onAcquire = () => {
      activeConnections++
      maxConcurrentConnections = Math.max(maxConcurrentConnections, activeConnections)
      if (activeConnections >= 2) signalTwoConnections()
    }
    const onRelease = () => {
      activeConnections--
    }

    pool.on('acquire', onAcquire)
    pool.on('release', onRelease)
    try {
      const result = await operation(() => twoConnections)
      return { result, maxConcurrentConnections }
    } finally {
      pool.off('acquire', onAcquire)
      pool.off('release', onRelease)
    }
  },
})
