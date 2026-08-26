/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AdminStore } from '@byline/admin'
import type { CollectionDefinition, IDbAdapter, ISchedulerStore } from '@byline/core'
import { afterAll, beforeAll } from 'vitest'

import { adminStoreSuite } from './suites/admin-store.js'
import { auditSuite } from './suites/audit.js'
import { countersSuite } from './suites/counters.js'
import { deleteLocaleSuite } from './suites/delete-locale.js'
import { documentAvailableLocalesSuite } from './suites/document-available-locales.js'
import { documentPathsSuite } from './suites/document-paths.js'
import { documentTreeSuite } from './suites/document-tree.js'
import { documentTreeAuditSuite } from './suites/document-tree-audit.js'
import { fieldTypesSuite } from './suites/field-types.js'
import { localeFallbackSuite } from './suites/locale-fallback.js'
import { publishSchedulesSuite } from './suites/publish-schedules.js'
import { restoreSuite } from './suites/restore.js'
import { schedulerSuite } from './suites/scheduler.js'
import { singletonMappingSuite } from './suites/singleton-mapping.js'
import { systemFieldsDirectWriteSuite } from './suites/system-fields-direct-write.js'
import { transactionsSuite } from './suites/transactions.js'
import { versioningSuite } from './suites/versioning.js'

export {
  type ClassifyErrorContractCase,
  runClassifyErrorContract,
} from './classify-error-contract.js'
/**
 * Named per-suite exports, additive alongside `runAdapterConformanceSuite`
 * below. An adapter mid-port (see `packages/db-mysql/tests/conformance.integration.test.ts`)
 * registers only the suites its current task has turned green, one `import`
 * per suite, instead of the full `runAdapterConformanceSuite` — which would
 * otherwise pull in every suite (including ones the adapter can't pass yet)
 * and turn `pnpm test:integration` red for the whole of the port. Once an
 * adapter passes every suite, its entry file switches to
 * `runAdapterConformanceSuite(hooks)` and drops these individual imports —
 * see the `db-postgres` conformance entry for the target shape.
 */
export { adminStoreSuite } from './suites/admin-store.js'
export { auditSuite } from './suites/audit.js'
export { countersSuite } from './suites/counters.js'
export { deleteLocaleSuite } from './suites/delete-locale.js'
export { documentAvailableLocalesSuite } from './suites/document-available-locales.js'
export { documentPathsSuite } from './suites/document-paths.js'
export { documentTreeSuite } from './suites/document-tree.js'
export { documentTreeAuditSuite } from './suites/document-tree-audit.js'
export { fieldTypesSuite } from './suites/field-types.js'
export { localeFallbackSuite } from './suites/locale-fallback.js'
export { restoreSuite } from './suites/restore.js'
export { schedulerSuite } from './suites/scheduler.js'
export { singletonMappingSuite } from './suites/singleton-mapping.js'
export { systemFieldsDirectWriteSuite } from './suites/system-fields-direct-write.js'
export { transactionsSuite } from './suites/transactions.js'
export { versioningSuite } from './suites/versioning.js'

/**
 * The seam a database adapter implements to run the shared behavioural
 * conformance suite against its own test database. `@byline/db-postgres`
 * consumes this today; a future `@byline/db-mysql` (or any other
 * `IDbAdapter` implementation) consumes the exact same suites by supplying
 * its own hooks.
 */
export interface ConformanceHooks {
  /**
   * Construct the adapter under test against the test database. Called once
   * per suite (~14× per run — see `runAdapterConformanceSuite` below), all of
   * which share the single `teardown()` call at the end of the run.
   * Implementations should memoise their connection pool across calls (open
   * it once, reuse it) rather than opening a fresh pool per call, to avoid
   * leaking pools until teardown.
   *
   * The adapter returned here must implement `classifyError` (optional on
   * `IDbAdapter`, but required to run this suite) — the `document-paths`
   * suite asserts it directly.
   */
  createAdapter(collections: readonly CollectionDefinition[]): Promise<IDbAdapter>
  /** Bring the test DB to current schema (idempotent). Called once per run. */
  migrate(): Promise<void>
  /** Truncate all Byline tables. Called once per suite, from each suite's `beforeAll`. */
  truncate(): Promise<void>
  /** Close pools/connections. */
  teardown(): Promise<void>
  /**
   * Construct the `AdminStore` bundle (admin users/roles/permissions/
   * preferences/refresh-tokens repositories, from `@byline/admin`) wired
   * against the same test database `createAdapter` uses. Optional — an
   * adapter without admin-store support simply omits this hook, and the
   * admin-store conformance suites are not registered at all (no
   * `describe`/`it` blocks exist for them, so they never show up as
   * skipped). Adapters that do provide it run every admin-store suite with
   * zero skips.
   */
  createAdminStore?(): Promise<AdminStore>

  /**
   * Construct the adapter's `ISchedulerStore` against the same test database.
   * Optional — an adapter without scheduler support omits it and the scheduler
   * suite is not registered at all, so it never appears as skipped.
   *
   * An adapter that provides this hook must also provide
   * `observeSchedulerContention`. The scheduler suite uses that observer to
   * prove its claim and reconciliation races exercised more than one physical
   * database connection instead of passing through a one-connection pool by
   * accidental serialization.
   */
  createSchedulerStore?(): Promise<ISchedulerStore>

  /**
   * Run one scheduler operation while observing the adapter's physical
   * database-connection lifecycle. `maxConcurrentConnections` is the peak
   * number of simultaneously checked-out connections during `operation`.
   *
   * This is test-harness instrumentation, not a production adapter API. It is
   * required whenever `createSchedulerStore` is present because the two race
   * tests are otherwise vacuous against a pool limited to one connection.
   */
  observeSchedulerContention?: SchedulerContentionObserver

  /**
   * Observe physical connection overlap during scheduled-publication claim
   * races. Required by `publishSchedulesSuite`; separate from the scheduler
   * observer so neither suite silently depends on an incidental hook name.
   */
  observePublishScheduleContention?: SchedulerContentionObserver
}

export interface SchedulerContentionObservation<T> {
  result: T
  maxConcurrentConnections: number
}

export type SchedulerContentionObserver = <T>(
  operation: () => Promise<T>
) => Promise<SchedulerContentionObservation<T>>

/**
 * Register the full storage conformance suite against `hooks`. Each suite is
 * an independent top-level `describe` block; its own `beforeAll` calls
 * `hooks.truncate()` before building its fixtures, so suites are isolated
 * from one another the same way the original per-file integration tests
 * were isolated by `_per-file-setup.ts`'s per-file truncate — the boundary
 * simply moved from "per file" to "per suite" now that every suite runs
 * inside one vitest file. Vitest runs sibling top-level `describe` blocks
 * sequentially (one block's `beforeAll`/tests/`afterAll` complete before the
 * next block's `beforeAll` starts), so truncating at the top of a suite's
 * `beforeAll` only ever discards the previous suite's already-finished data.
 *
 * `migrate()` runs once before any suite (idempotent — safe alongside a
 * consumer's own global migration step) and `teardown()` runs once after
 * every suite has finished, closing the adapter's pools/connections.
 */
export function runAdapterConformanceSuite(hooks: ConformanceHooks): void {
  beforeAll(async () => {
    await hooks.migrate()
  })

  afterAll(async () => {
    await hooks.teardown()
  })

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
  auditSuite(hooks)
  countersSuite(hooks)
  singletonMappingSuite(hooks)
  adminStoreSuite(hooks)
  if (hooks.createSchedulerStore) {
    schedulerSuite(hooks)
  }
  publishSchedulesSuite(hooks)
}
