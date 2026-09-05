/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Request-scoped transaction propagation via AsyncLocalStorage.
 *
 * Ported from the Modulus project (`db-manager.ts`) — the same ALS mechanism
 * Byline's logger already uses (`packages/core/src/lib/logger.ts`,
 * `withLogContext`). The full design — the service-owned `withTransaction`
 * boundary, the DB↔DB vs DB↔external distinction, the incremental-adoption
 * caveat, and the serverless db-contract-seam decisions — lives in
 * `docs/03-architecture/03-transactions.md`. This machinery is deliberately adapter-internal:
 * transactions are driver-specific, so `@byline/core` only declares the
 * `withTransaction` capability on `IDbAdapter`, never the implementation.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

import { DbErrorCodes, ERR_LOCK_CONFLICT } from '@byline/core'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { classifyError } from '../modules/storage/classify-error.js'
import type * as schema from '../database/schema/index.js'

/**
 * The executor every storage command runs on: either the connection pool
 * (autonomous, statement-at-a-time) or — when a `withTransaction` boundary is
 * open in the current async context — that transaction. Commands obtain it via
 * `DBManager.get()` and never thread a transaction handle through their
 * signatures.
 */
export type DBExecutor = NodePgDatabase<typeof schema>

export interface DBManager {
  /**
   * The current executor: the ambient transaction when a `withTransaction`
   * boundary is open in this async context, otherwise the pool.
   */
  get(): DBExecutor
  /** Whether the current async context owns an ambient transaction. */
  isInTransaction(): boolean
  getTransactionScope(): object | undefined
  getTransactionToken(): object | undefined
  isTransactionTokenActive(token: object): boolean
  runInTransaction<T>(executor: DBExecutor, fn: () => Promise<T>): Promise<T>
}

export class DBManagerImpl implements DBManager {
  private readonly transactionALS = new AsyncLocalStorage<{ executor: DBExecutor; scope: object }>()
  private readonly activeTransactions = new WeakSet<object>()
  private readonly dbPool: DBExecutor

  constructor(deps: { dbPool: DBExecutor }) {
    this.dbPool = deps.dbPool
  }

  get(): DBExecutor {
    return this.transactionALS.getStore()?.executor ?? this.dbPool
  }

  isInTransaction(): boolean {
    return this.getTransactionToken() != null
  }

  getTransactionScope(): object | undefined {
    return this.getTransactionToken() != null ? this.transactionALS.getStore()?.scope : undefined
  }

  getTransactionToken(): object | undefined {
    const frame = this.transactionALS.getStore()
    return frame != null && this.activeTransactions.has(frame) ? frame : undefined
  }

  isTransactionTokenActive(token: object): boolean {
    return this.activeTransactions.has(token)
  }

  async runInTransaction<T>(executor: DBExecutor, fn: () => Promise<T>): Promise<T> {
    // Share lock ordering with savepoints. Observations issued inside a savepoint
    // expire when it ends: rollback can release the row locks it acquired.
    const frame = { executor, scope: this.getTransactionScope() ?? {} }
    this.activeTransactions.add(frame)
    try {
      return await this.transactionALS.run(frame, fn)
    } finally {
      this.activeTransactions.delete(frame)
    }
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

  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    const ownsTransaction = !this.db.isInTransaction()
    let callbackError: unknown
    let callbackFailed = false
    const guarded = async () => {
      try {
        return await fn()
      } catch (error) {
        callbackFailed = true
        callbackError = error
        throw error
      }
    }
    try {
      return await this.db.get().transaction(
        (tx) =>
          // `tx` is Drizzle's PgTransaction; it carries the full query-builder
          // surface every command uses. The cast bridges the one structural gap
          // to NodePgDatabase — the transaction lacks `$client`, which no command
          // touches. See docs/03-architecture/03-transactions.md.
          this.db.runInTransaction(tx as unknown as DBExecutor, guarded),
        { isolationLevel: 'read committed' }
      )
    } catch (error) {
      // Drizzle rethrows the callback error only after ROLLBACK succeeds. A
      // rollback failure replaces it; a COMMIT failure has no callback error.
      // Never infer safe retry from either of those uncertain outcomes, nor
      // from a savepoint rollback inside an externally owned transaction.
      if (
        ownsTransaction &&
        callbackFailed &&
        error === callbackError &&
        classifyError(error).code === DbErrorCodes.LOCK_CONFLICT
      ) {
        throw ERR_LOCK_CONFLICT({
          message:
            'This change could not be saved because another operation was using the document. Reload before trying again.',
          cause: error,
          details: { reason: 'lock_conflict', rolledBack: true, retryable: true },
        })
      }
      throw error
    }
  }
}
