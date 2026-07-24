/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Request-scoped transaction propagation via AsyncLocalStorage.
 *
 * Mirrors the Postgres adapter's `db-manager.ts` — the same ALS mechanism
 * Byline's logger already uses (`packages/core/src/lib/logger.ts`,
 * `withLogContext`). The full design — the service-owned `withTransaction`
 * boundary, the DB↔DB vs DB↔external distinction, the incremental-adoption
 * caveat, and the serverless db-contract-seam decisions — lives in
 * `docs/03-architecture/03-transactions.md`. This machinery is deliberately adapter-internal:
 * transactions are driver-specific, so `@byline/core` only declares the
 * `withTransaction` capability on `IDbAdapter`, never the implementation.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

import type { MySql2Database } from 'drizzle-orm/mysql2'

// TODO(Task 8): parameterize with `typeof schema` once
// `src/database/schema/index.ts` lands, mirroring the pg adapter's
// `MySql2Database<typeof schema>`. The schema module does not exist yet —
// Task 7 is package skeleton only.
export type DBExecutor = MySql2Database<Record<string, never>>

const transactionALS = new AsyncLocalStorage<DBExecutor>()

export interface DBManager {
  /**
   * The current executor: the ambient transaction when a `withTransaction`
   * boundary is open in this async context, otherwise the pool.
   */
  get(): DBExecutor
}

export class DBManagerImpl implements DBManager {
  private readonly dbPool: DBExecutor

  constructor(deps: { dbPool: DBExecutor }) {
    this.dbPool = deps.dbPool
  }

  get(): DBExecutor {
    return transactionALS.getStore() ?? this.dbPool
  }
}

export interface TXManager {
  /**
   * Run `fn` inside a single database transaction. Every `DBManager.get()`
   * call made during `fn` (transitively, across `await`s) returns that
   * transaction, so the commands `fn` invokes commit or roll back together.
   *
   * Nesting: when already inside a `withTransaction`, the inner call opens a
   * SAVEPOINT (Drizzle nested transaction) — an inner throw rolls back to the
   * savepoint, an outer throw rolls back everything.
   */
  withTransaction<T>(fn: () => Promise<T>): Promise<T>
}

export class TXManagerImpl implements TXManager {
  private readonly db: DBManager

  constructor(deps: { db: DBManager }) {
    this.db = deps.db
  }

  withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.db.get().transaction(
      (tx) =>
        // `tx` is Drizzle's MySqlTransaction; it carries the full
        // query-builder surface every command uses. The cast bridges the
        // structural gap to MySql2Database the same way the pg adapter
        // bridges to NodePgDatabase. See docs/03-architecture/03-transactions.md.
        transactionALS.run(tx as unknown as DBExecutor, fn),
      {
        // Spec decision: pin the isolation level to match the pg adapter's
        // assumptions (Postgres's default is READ COMMITTED; MySQL/InnoDB
        // defaults to REPEATABLE READ). Canonical adapters must behave
        // identically for the shared db-conformance suite.
        isolationLevel: 'read committed',
      }
    )
  }
}
