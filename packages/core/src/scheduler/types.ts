/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { BylineLogger } from '../logger/index.js'

/** Lifecycle state of a registered task, as persisted by the store. */
export type RecurringTaskStatus = 'never_run' | 'running' | 'succeeded' | 'failed'

/**
 * What a handler may tell the runner when it returns.
 *
 * `workRemaining` means the handler stopped on a batch budget rather than an
 * empty queue. The runner then sets the next run to database-now instead of
 * database-now plus the interval. This only accelerates a task whose interval
 * exceeds the tick cadence; a task already at the 60s minimum becomes due on
 * the next tick either way.
 */
export interface RecurringTaskResult {
  workRemaining?: boolean
}

/** Everything a handler is given for one execution. */
export interface RecurringTaskContext {
  taskName: string
  /** The `next_run_at` that made this task due. Diagnostic, not a business cursor. */
  scheduledFor: Date
  /** Aborted on shutdown or on lease loss. Handlers check it between batches. */
  signal: AbortSignal
  logger: BylineLogger
  /** Renew the lease. Rejects when the lease has been lost, which aborts the run. */
  heartbeat(): Promise<void>
}

export interface RecurringTaskDefinition {
  /** Stable, code-owned, globally unique key, e.g. `analytics.rollup`. */
  name: string
  /** Delay after a successful run. Minimum 60_000. */
  intervalMs: number
  /** Initial lease window. Minimum 60_000. A long run renews before it expires. */
  leaseMs: number
  run(context: RecurringTaskContext): Promise<RecurringTaskResult | void>
}

/** A task successfully claimed by this instance. */
export interface ClaimedRecurringTask {
  name: string
  /** Unique to this claim. Every later write is conditional on it. */
  leaseToken: string
  scheduledFor: Date
  /** Database time at the moment of the claim. */
  databaseNow: Date
}

/** Read-only health row for diagnostics and admin surfaces. */
export interface RecurringTaskHealth {
  name: string
  intervalMs: number
  nextRunAt: Date
  lastStatus: RecurringTaskStatus
  lastStartedAt: Date | null
  lastSucceededAt: Date | null
  lastFailedAt: Date | null
  lastDurationMs: number | null
  consecutiveFailures: number
  lastError: string | null
  /** True when a lease exists and has passed its expiry — a crashed runner. */
  leaseExpired: boolean
  /** Database time when this row was read, so callers can judge staleness. */
  databaseNow: Date
}

/** What a definition contributes to reconciliation. */
export interface ReconcileTaskInput {
  name: string
  intervalMs: number
}

/**
 * The optional scheduler capability a database adapter implements. Every method
 * derives due-ness and expiry from database time, never from the process clock.
 */
export interface ISchedulerStore {
  /**
   * Insert rows for unknown names and update `interval_ms` for known ones,
   * preserving health history and any live lease. Must be safe to run
   * concurrently from several instances — a deploy restarts them together.
   *
   * When an interval decreases, an unleased `next_run_at` is clamped to no
   * later than database-now plus the new interval.
   */
  reconcile(tasks: readonly ReconcileTaskInput[]): Promise<void>

  /**
   * Atomically claim `name` if it is due and unleased (or its lease expired).
   * Returns null when another instance won or the task is not yet due.
   */
  claim(params: {
    name: string
    leaseMs: number
    owner: string
  }): Promise<ClaimedRecurringTask | null>

  /** Extend a token-matched lease. Returns false when the lease has been lost. */
  renew(params: { name: string; leaseToken: string; leaseMs: number }): Promise<boolean>

  /**
   * Record success on a token-matched row: clear the lease and failure state and
   * set `next_run_at` to database-now plus `intervalMs`, or to database-now when
   * `workRemaining` is true. Returns false when the lease had been lost.
   */
  complete(params: {
    name: string
    leaseToken: string
    intervalMs: number
    durationMs: number
    workRemaining: boolean
  }): Promise<boolean>

  /**
   * Record failure on a token-matched row: clear the lease, increment
   * `consecutive_failures`, store a bounded error, and schedule the bounded
   * retry backoff. Returns false when the lease had been lost.
   */
  fail(params: {
    name: string
    leaseToken: string
    durationMs: number
    error: string
  }): Promise<boolean>

  /** Health rows for the named tasks, or all rows when `names` is omitted. */
  health(names?: readonly string[]): Promise<RecurringTaskHealth[]>
}
