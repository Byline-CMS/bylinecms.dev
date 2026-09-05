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

import type { AdminStore } from '@byline/admin'
import type { CollectionDefinition, IDbAdapter, ISchedulerStore } from '@byline/core'
import { runAdapterConformanceSuite } from '@byline/db-conformance'
import { eq } from 'drizzle-orm'

import { documents } from '../src/database/schema/index.js'
import { assertTestDatabase, migrateTestDatabase, resetTestDatabase } from '../src/lib/test-db.js'
import { setupTestDB, teardownTestDB } from '../src/lib/test-helper.js'
import { createAdminStore as createPgAdminStore } from '../src/modules/admin/admin-store.js'
import { createAuditCommands } from '../src/modules/audit/audit-commands.js'
import { createAuditQueries } from '../src/modules/audit/audit-queries.js'
import { createCounterCommands } from '../src/modules/counters/counters-commands.js'
import { createSchedulerStore } from '../src/modules/scheduler/scheduler-store.js'
import { classifyError } from '../src/modules/storage/classify-error.js'
import { DocumentRevisions } from '../src/modules/storage/document-revisions.js'
import { SingletonCommands, SingletonQueries } from '../src/modules/storage/singletons.js'

function getConnectionString(): string {
  const connectionString = process.env.BYLINE_DB_POSTGRES_CONNECTION_STRING
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
    const counterCommands = createCounterCommands(testDb.db)
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
        ...testDb.queryBuilders,
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
    return createPgAdminStore(testDb.db)
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
      await executor.execute(sql`SET LOCAL lock_timeout = '100ms'`)
      return work()
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
