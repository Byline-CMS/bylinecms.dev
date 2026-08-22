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
  /**
   * True when this claim took over a lease that had expired — i.e. a previous
   * runner died mid-execution without recording an outcome. The runner logs a
   * distinct `recovered-expired-lease` event for these. False for an ordinary
   * claim of an unleased row.
   */
  recoveredExpiredLease: boolean
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
 *
 * A MySQL (or any third) adapter implementing this interface should be able to
 * do so from the doc comments below without reading the design spec — every
 * method states exactly which columns it reads and writes.
 *
 * One rule holds across every method and is not repeated below: every
 * successful mutation — `reconcile`, `claim`, `renew`, `complete`, `fail` —
 * also sets `updated_at` from database time, in addition to the per-method
 * column lists that follow.
 */
export interface ISchedulerStore {
  /**
   * Insert rows for unknown names and update `interval_ms` for known ones,
   * preserving health history. Must be safe to run concurrently from several
   * instances — a deploy restarts them together.
   *
   * A brand-new row's `next_run_at` is database-now **plus** the task's
   * `intervalMs` — a task never fires at module evaluation or immediately on
   * deploy; the first execution is one interval after the row is created.
   *
   * For an existing, unleased row:
   *
   * - When the interval **decreases**, `next_run_at` is clamped to no later
   *   than database-now plus the new interval, so a task moving from a daily
   *   to a minute-grained cadence does not wait out the rest of the old day.
   * - When the interval **increases**, an already-due or earlier-scheduled
   *   `next_run_at` is left alone — it is NOT postponed to reflect the new,
   *   longer interval. The new cadence takes effect starting from the next
   *   time the row completes successfully (see `complete` below).
   *
   * `interval_ms` is always updated, including on a row carrying a live
   * lease (`lease_expires_at` in the future) — the lease protects
   * `next_run_at` and the lease columns themselves (`lease_token`,
   * `lease_owner`, `lease_expires_at`), which are left untouched while a
   * lease is live, but not `interval_ms`. This matters because `complete`
   * derives `next_run_at` from the row's persisted `interval_ms` rather than
   * from a caller-supplied value (see `complete` below); if reconcile
   * skipped leased rows entirely, a newly deployed cadence would not take
   * effect until the in-flight lease released, which would partially defeat
   * the reason `complete` stopped accepting an interval from the runner. A
   * rolling deploy is exactly the moment both a reconcile and a live lease
   * are likely to coincide.
   *
   * Rows for names no longer present in the registered task set are retained
   * as dormant history: reconcile neither executes them nor deletes them.
   * Pruning dormant rows is a future explicit maintenance operation, not a
   * side effect of reconcile.
   */
  reconcile(tasks: readonly ReconcileTaskInput[]): Promise<void>

  /**
   * Atomically claim `name` if it is due (`next_run_at <= database now`) and
   * either unleased or its lease has expired. Returns null when another
   * instance won the race or the task is not yet due.
   *
   * On a successful claim, exactly these columns are mutated:
   *
   * - `lease_token` — set to a fresh, claim-unique token.
   * - `lease_owner` — set to the caller-supplied `owner` label.
   * - `lease_expires_at` — set to database-now plus `leaseMs`.
   * - `last_started_at` — set to database-now.
   * - `last_status` — set to `'running'`.
   *
   * `next_run_at` is deliberately left untouched by claim. The returned
   * `scheduledFor` is that pre-claim `next_run_at` value — the due time that
   * made the row eligible, not a new value computed at claim time. Because
   * claim never advances `next_run_at`, a row whose runner died without
   * calling `complete` or `fail` stays due, so another instance can reclaim
   * it the moment `lease_expires_at` passes (`recoveredExpiredLease: true`
   * on that claim — see `ClaimedRecurringTask`).
   */
  claim(params: {
    name: string
    leaseMs: number
    owner: string
  }): Promise<ClaimedRecurringTask | null>

  /**
   * Extend a token-matched lease: sets `lease_expires_at` to database-now
   * plus `leaseMs`. Every write here and below is conditioned on
   * `lease_token = params.leaseToken` — a stale runner whose lease has since
   * been reclaimed by another instance cannot successfully renew, complete,
   * or fail the row. Returns `false` (never throws) when the token does not
   * match — i.e. the lease had already been lost.
   */
  renew(params: { name: string; leaseToken: string; leaseMs: number }): Promise<boolean>

  /**
   * Record success on a token-matched row.
   *
   * Fields cleared: `lease_token`, `lease_owner`, `lease_expires_at` (all set
   * to null — the row is unleased again).
   *
   * Fields reset: `consecutive_failures` back to 0, `last_error` to null —
   * a success always clears prior failure state regardless of how many
   * failures preceded it.
   *
   * Fields recorded: `last_succeeded_at` and `last_duration_ms` from
   * `durationMs`; `last_status` set to `'succeeded'`.
   *
   * `next_run_at` becomes database-now plus the row's **persisted**
   * `interval_ms` — never an interval supplied by the caller. A runner that
   * has been holding a lease across a rolling deploy may be carrying a stale
   * cadence; reading the column instead means a newly reconciled interval
   * always wins. When `workRemaining` is true, `next_run_at` becomes
   * database-now instead, ignoring the interval entirely.
   *
   * Returns `false` (never throws) when the token does not match — the
   * lease had already been lost.
   */
  complete(params: {
    name: string
    leaseToken: string
    durationMs: number
    workRemaining: boolean
  }): Promise<boolean>

  /**
   * Record failure on a token-matched row.
   *
   * Fields cleared: `lease_token`, `lease_owner`, `lease_expires_at` (all set
   * to null — the row is unleased again, so another instance may claim it
   * once `next_run_at` is reached).
   *
   * Fields incremented / stored: `consecutive_failures` is incremented by
   * one; `last_error` is stored, truncated to 2048 characters and never
   * containing a stack trace (full stacks belong in the configured logger,
   * not this column). `last_failed_at` and `last_duration_ms` are recorded
   * from `durationMs`; `last_status` is set to `'failed'`.
   *
   * `next_run_at` becomes database-now plus a bounded backoff derived from
   * the just-incremented `consecutive_failures`: 1, 2, 4, 8 minutes for the
   * first four consecutive failures, then capped at 15 minutes for the fifth
   * and every subsequent consecutive failure. A later success (`complete`)
   * restores the configured `interval_ms` and resets this sequence — the
   * backoff never compounds across a success.
   *
   * Returns `false` (never throws) when the token does not match — the
   * lease had already been lost.
   */
  fail(params: {
    name: string
    leaseToken: string
    durationMs: number
    error: string
  }): Promise<boolean>

  /**
   * Health rows for the named tasks, or all rows when `names` is omitted.
   *
   * `lease_owner` is a bounded, non-secret diagnostic label (typically a
   * machine id plus process id), capped at 255 characters. Correctness never
   * depends on it being unique — fencing is entirely a function of
   * `lease_token`, never of `lease_owner`.
   */
  health(names?: readonly string[]): Promise<RecurringTaskHealth[]>
}
