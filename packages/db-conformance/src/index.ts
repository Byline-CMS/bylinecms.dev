/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AdminStore } from '@byline/admin'
import type { CollectionDefinition, IDbAdapter } from '@byline/core'
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
import { restoreSuite } from './suites/restore.js'
import { systemFieldsDirectWriteSuite } from './suites/system-fields-direct-write.js'
import { transactionsSuite } from './suites/transactions.js'
import { versioningSuite } from './suites/versioning.js'

/**
 * The seam a database adapter implements to run the shared behavioural
 * conformance suite against its own test database. `@byline/db-postgres`
 * consumes this today; a future `@byline/db-mysql` (or any other
 * `IDbAdapter` implementation) consumes the exact same suites by supplying
 * its own hooks.
 */
export interface ConformanceHooks {
  /** Construct the adapter under test against the test database. */
  createAdapter(collections: readonly CollectionDefinition[]): Promise<IDbAdapter>
  /** Bring the test DB to current schema (idempotent). Called once per run. */
  migrate(): Promise<void>
  /** Truncate all Byline tables. Called between test files. */
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
}

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
  adminStoreSuite(hooks)
}
