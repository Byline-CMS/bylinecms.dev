/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Postgres implementation of `ISchedulerStore` (specs/2026-08-22-scheduler.md)
 * — the claim/fencing protocol backing the recurring-task scheduler. Every
 * statement derives due-ness and expiry from database time (`now()`), never
 * from the process clock, and every write after a successful claim is
 * conditioned on a matching `lease_token` so a runner whose lease has been
 * reclaimed by another instance cannot overwrite a newer run.
 *
 * `interval_ms` and `last_duration_ms` are `bigint` columns; the `pg` driver
 * returns bigint as a string by default. Both are coerced to `number` here —
 * boot-time validation (`validateRecurringTasks`) guarantees every millisecond
 * value is a JS safe integer, so `Number(...)` is sound.
 */

import type {
  ClaimedRecurringTask,
  ISchedulerStore,
  ReconcileTaskInput,
  RecurringTaskHealth,
  RecurringTaskStatus,
} from '@byline/core'
import { MAX_BACKOFF_MS } from '@byline/core/scheduler'
import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import type * as schema from '../../database/schema/index.js'

type DatabaseConnection = NodePgDatabase<typeof schema>

/** Doc comment on `ISchedulerStore.fail`: 2048 characters, never a stack trace. */
const LAST_ERROR_MAX_LENGTH = 2048

/** Doc comment on `ISchedulerStore.health`: `lease_owner` capped at 255 characters. */
const LEASE_OWNER_MAX_LENGTH = 255

/** `MAX_BACKOFF_MS` is milliseconds; `make_interval(secs => ...)` wants seconds. */
const MAX_BACKOFF_SECONDS = MAX_BACKOFF_MS / 1000

type ClaimRow = {
  name: string
  lease_token: string
  scheduled_for: Date
  database_now: Date
  recovered_expired_lease: boolean
}

type HealthRow = {
  name: string
  interval_ms: string
  next_run_at: Date
  last_status: RecurringTaskStatus
  last_started_at: Date | null
  last_succeeded_at: Date | null
  last_failed_at: Date | null
  last_duration_ms: string | null
  consecutive_failures: number
  last_error: string | null
  lease_expired: boolean
  database_now: Date
}

export class SchedulerStore implements ISchedulerStore {
  constructor(private db: DatabaseConnection) {}

  /**
   * One conflict-tolerant `INSERT ... ON CONFLICT DO UPDATE` per task —
   * never read-then-write, so a deploy that restarts every instance at once
   * reconciles the same names safely under concurrency.
   */
  async reconcile(tasks: readonly ReconcileTaskInput[]): Promise<void> {
    for (const task of tasks) {
      await this.db.execute(sql`
        INSERT INTO byline_recurring_tasks (name, interval_ms, next_run_at, last_status)
        VALUES (
          ${task.name},
          ${task.intervalMs},
          now() + make_interval(secs => ${task.intervalMs} / 1000.0),
          'never_run'
        )
        ON CONFLICT (name) DO UPDATE SET
          interval_ms = EXCLUDED.interval_ms,
          next_run_at = CASE
            WHEN byline_recurring_tasks.lease_token IS NULL
             AND byline_recurring_tasks.next_run_at
                   > now() + make_interval(secs => ${task.intervalMs} / 1000.0)
            THEN now() + make_interval(secs => ${task.intervalMs} / 1000.0)
            ELSE byline_recurring_tasks.next_run_at
          END,
          updated_at = now()
      `)
    }
  }

  /**
   * Atomic claim. The `old_row` CTE takes `FOR UPDATE` on the row under the
   * same eligibility predicate the outer UPDATE relies on, so a concurrent
   * claim attempt on the same name blocks on the row lock, re-evaluates the
   * predicate against the post-commit row (Postgres's EvalPlanQual), and
   * naturally loses the race once the winner's write is visible — no second
   * read, no window for a double claim.
   *
   * `old_row.lease_expires_at` is the pre-claim value (captured before the
   * outer UPDATE's SET list ever assigns a new one), so
   * `recovered_expired_lease` correctly describes the row's state *before*
   * this claim: null means an ordinary claim of an unleased row, non-null
   * means this claim took over a lease that had expired.
   *
   * Precondition: the "loser blocks, re-checks, returns null" behaviour
   * above depends on running at Postgres's default **READ COMMITTED**
   * isolation level (Byline's connection pool never overrides this). Under
   * REPEATABLE READ or SERIALIZABLE, a blocked `FOR UPDATE` raises `40001
   * could not serialize access due to concurrent update` instead of
   * filtering, so `claim` would throw where the contract says it returns
   * `null`.
   *
   * Precondition: call `claim` (and `reconcile`) *outside* a
   * `withTransaction` boundary. Inside one, `now()` is pinned to
   * transaction-start time — due-ness and expiry checks stop reflecting
   * real elapsed time — and the row lock this statement takes would be held
   * for the whole enclosing transaction, convoying every other instance's
   * claim attempt for the same task name until that transaction commits.
   */
  async claim(params: {
    name: string
    leaseMs: number
    owner: string
  }): Promise<ClaimedRecurringTask | null> {
    const truncatedOwner = params.owner.slice(0, LEASE_OWNER_MAX_LENGTH)
    const result = await this.db.execute<ClaimRow>(sql`
      WITH old_row AS (
        SELECT name, lease_expires_at
        FROM byline_recurring_tasks
        WHERE name = ${params.name}
          AND next_run_at <= now()
          AND (lease_expires_at IS NULL OR lease_expires_at <= now())
        FOR UPDATE
      )
      UPDATE byline_recurring_tasks t SET
        lease_token = gen_random_uuid(),
        lease_owner = ${truncatedOwner},
        lease_expires_at = now() + make_interval(secs => ${params.leaseMs} / 1000.0),
        last_started_at = now(),
        last_status = 'running',
        updated_at = now()
      FROM old_row
      WHERE t.name = old_row.name
      RETURNING
        t.name,
        t.lease_token,
        t.next_run_at AS scheduled_for,
        now() AS database_now,
        (old_row.lease_expires_at IS NOT NULL) AS recovered_expired_lease
    `)

    const row = result.rows[0]
    if (row === undefined) return null

    return {
      name: row.name,
      leaseToken: row.lease_token,
      scheduledFor: row.scheduled_for,
      databaseNow: row.database_now,
      recoveredExpiredLease: row.recovered_expired_lease,
    }
  }

  /**
   * Token-matched lease extension. `false` (never throws) when the token no
   * longer matches.
   *
   * `lease_token` is a `uuid` column; comparing it against `$N` directly
   * would resolve the parameter as `uuid`, so Postgres parses the bound text
   * *before* comparing and a non-UUID `leaseToken` raises `22P02 invalid
   * input syntax for type uuid` instead of matching zero rows. The contract
   * requires "never throws" here, and the conformance suite is
   * backend-neutral — a MySQL `char(36)` column would just fail to match and
   * return `false` for the same input, so this cast keeps Postgres behaving
   * the same way. Casting the column to `text` rather than the parameter to
   * `uuid` forfeits any index on `lease_token`, but the predicate is already
   * anchored on `name` (the primary key), so this is a filter over exactly
   * one row and costs nothing.
   */
  async renew(params: { name: string; leaseToken: string; leaseMs: number }): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE byline_recurring_tasks
      SET lease_expires_at = now() + make_interval(secs => ${params.leaseMs} / 1000.0),
          updated_at = now()
      WHERE name = ${params.name} AND lease_token::text = ${params.leaseToken}
    `)
    return result.rowCount === 1
  }

  /**
   * Token-matched success. `next_run_at` derives from the row's own
   * persisted `interval_ms` — never a caller-supplied interval — because
   * Postgres evaluates SET expressions against the OLD row, which is the
   * persisted cadence, so a runner holding a lease across a rolling deploy
   * cannot write a stale cadence over a newly reconciled one.
   */
  async complete(params: {
    name: string
    leaseToken: string
    durationMs: number
    workRemaining: boolean
  }): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE byline_recurring_tasks SET
        last_succeeded_at = now(),
        last_status = 'succeeded',
        last_duration_ms = ${params.durationMs},
        consecutive_failures = 0,
        last_error = NULL,
        lease_token = NULL,
        lease_owner = NULL,
        lease_expires_at = NULL,
        next_run_at = CASE
          WHEN ${params.workRemaining} THEN now()
          ELSE now() + make_interval(secs => interval_ms / 1000.0)
        END,
        updated_at = now()
      WHERE name = ${params.name} AND lease_token::text = ${params.leaseToken}
    `)
    return result.rowCount === 1
  }

  /**
   * Token-matched failure. Backoff is 1, 2, 4, 8 minutes for the first four
   * consecutive failures, then capped at `MAX_BACKOFF_MS` (15 minutes) for
   * the fifth and every subsequent one. `consecutive_failures` in the
   * `LEAST(...)` expression is read from the OLD row (pre-increment) —
   * because the exponent for the Nth failure is N-1, the OLD value already
   * equals that exponent, so no separate +1 is needed here.
   */
  async fail(params: {
    name: string
    leaseToken: string
    durationMs: number
    error: string
  }): Promise<boolean> {
    const truncatedError = params.error.slice(0, LAST_ERROR_MAX_LENGTH)
    const result = await this.db.execute(sql`
      UPDATE byline_recurring_tasks SET
        last_failed_at = now(),
        last_status = 'failed',
        last_duration_ms = ${params.durationMs},
        consecutive_failures = consecutive_failures + 1,
        last_error = ${truncatedError},
        lease_token = NULL,
        lease_owner = NULL,
        lease_expires_at = NULL,
        next_run_at = now() + make_interval(secs => LEAST(
          60 * power(2, LEAST(consecutive_failures, 4))::int,
          ${MAX_BACKOFF_SECONDS}
        )),
        updated_at = now()
      WHERE name = ${params.name} AND lease_token::text = ${params.leaseToken}
    `)
    return result.rowCount === 1
  }

  /**
   * Health rows for the named tasks, or every row when `names` is omitted.
   *
   * `nameList` must bind as a single array-typed parameter, not one bound
   * value per element: drizzle's `sql` tag tests `Array.isArray(chunk)`
   * before it tests for a `Param`, so a bare `${nameList}` interpolation
   * expands into a parenthesised row constructor (`($1, $2)`) rather than an
   * array literal — the exact trap already documented at
   * `storage-queries.ts`'s `$in`/`$nin` and locale-chain call sites. Wrapping
   * with `sql.param(...)` forces it through the `Param` branch instead, so it
   * binds as one `text[]`-typed parameter and `= ANY(...)` / `::text[]` both
   * see an array, not a tuple.
   */
  async health(names?: readonly string[]): Promise<RecurringTaskHealth[]> {
    const nameList = names ? [...names] : null
    const result = await this.db.execute<HealthRow>(sql`
      SELECT name, interval_ms, next_run_at, last_status, last_started_at, last_succeeded_at,
             last_failed_at, last_duration_ms, consecutive_failures, last_error,
             (lease_expires_at IS NOT NULL AND lease_expires_at <= now()) AS lease_expired,
             now() AS database_now
      FROM byline_recurring_tasks
      WHERE (${sql.param(nameList)}::text[] IS NULL OR name = ANY(${sql.param(nameList)}))
      ORDER BY name
    `)

    return result.rows.map((row) => ({
      name: row.name,
      intervalMs: Number(row.interval_ms),
      nextRunAt: row.next_run_at,
      lastStatus: row.last_status,
      lastStartedAt: row.last_started_at,
      lastSucceededAt: row.last_succeeded_at,
      lastFailedAt: row.last_failed_at,
      lastDurationMs: row.last_duration_ms === null ? null : Number(row.last_duration_ms),
      consecutiveFailures: row.consecutive_failures,
      lastError: row.last_error,
      leaseExpired: row.lease_expired,
      databaseNow: row.database_now,
    }))
  }
}

export function createSchedulerStore(db: DatabaseConnection): ISchedulerStore {
  return new SchedulerStore(db)
}
