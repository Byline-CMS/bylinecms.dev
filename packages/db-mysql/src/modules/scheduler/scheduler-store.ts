/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * MySQL implementation of `ISchedulerStore` (specs/2026-08-22-scheduler.md).
 * Every due and lease comparison uses database UTC time, and every write after
 * a claim is fenced by the claim's token.
 *
 * MySQL has no `UPDATE ... RETURNING`, so `claim()` locks the eligible row,
 * updates it, and returns the pre-claim schedule from one READ COMMITTED
 * transaction. The transaction is deliberately store-owned rather than ambient:
 * scheduler claims must not inherit a caller's longer transaction boundary.
 */

import { randomUUID } from 'node:crypto'

import type {
  ClaimedRecurringTask,
  ISchedulerStore,
  ReconcileTaskInput,
  RecurringTaskHealth,
  RecurringTaskStatus,
} from '@byline/core'
import { MAX_BACKOFF_MS } from '@byline/core/scheduler'
import { sql } from 'drizzle-orm'
import type { MySql2Database } from 'drizzle-orm/mysql2'

import { affectedRowCount, toDate } from '../storage/storage-utils.js'
import type * as schema from '../../database/schema/index.js'

type DatabaseConnection = MySql2Database<typeof schema>

/** Doc comment on `ISchedulerStore.fail`: 2048 characters, never a stack trace. */
const LAST_ERROR_MAX_LENGTH = 2048

/** Doc comment on `ISchedulerStore.health`: `lease_owner` capped at 255 characters. */
const LEASE_OWNER_MAX_LENGTH = 255

const MAX_BACKOFF_SECONDS = MAX_BACKOFF_MS / 1000

type ClaimRow = {
  name: string
  scheduled_for: string | Date
  database_now: string | Date
  recovered_expired_lease: number | boolean
}

type HealthRow = {
  name: string
  interval_ms: string | number
  next_run_at: string | Date
  last_status: RecurringTaskStatus
  last_started_at: string | Date | null
  last_succeeded_at: string | Date | null
  last_failed_at: string | Date | null
  last_duration_ms: string | number | null
  consecutive_failures: number
  last_error: string | null
  lease_expired: number | boolean
  database_now: string | Date
}

function requiredDate(value: string | Date, context: string): Date {
  const date = toDate(value, context)
  if (date === null) {
    throw new Error(`scheduler store: ${context} unexpectedly returned null`)
  }
  return date
}

class SchedulerStore implements ISchedulerStore {
  constructor(private db: DatabaseConnection) {}

  /**
   * One conflict-tolerant upsert per definition. `interval_ms` always follows
   * code, while an unleased `next_run_at` is only pulled earlier when the new
   * interval would otherwise leave the task waiting too long.
   */
  async reconcile(tasks: readonly ReconcileTaskInput[]): Promise<void> {
    for (const task of tasks) {
      await this.db.execute(sql`
        INSERT INTO byline_recurring_tasks (name, interval_ms, next_run_at, last_status)
        VALUES (
          ${task.name},
          ${task.intervalMs},
          TIMESTAMPADD(MICROSECOND, ${task.intervalMs} * 1000, CURRENT_TIMESTAMP(6)),
          'never_run'
        )
        ON DUPLICATE KEY UPDATE
          next_run_at = CASE
            WHEN lease_token IS NULL
             AND next_run_at > TIMESTAMPADD(
               MICROSECOND,
               ${task.intervalMs} * 1000,
               CURRENT_TIMESTAMP(6)
             )
            THEN TIMESTAMPADD(MICROSECOND, ${task.intervalMs} * 1000, CURRENT_TIMESTAMP(6))
            ELSE next_run_at
          END,
          interval_ms = ${task.intervalMs},
          updated_at = CURRENT_TIMESTAMP(6)
      `)
    }
  }

  /**
   * Atomic claim through a locking read and fenced update on one physical
   * connection. Under READ COMMITTED, contenders blocked on `FOR UPDATE`
   * re-check the eligibility predicate after the winner commits and return
   * null instead of observing the stale due row.
   */
  async claim(params: {
    name: string
    leaseMs: number
    owner: string
  }): Promise<ClaimedRecurringTask | null> {
    return this.db.transaction(
      async (tx) => {
        const selected = (await tx.execute(sql`
          SELECT
            name,
            next_run_at AS scheduled_for,
            CURRENT_TIMESTAMP(6) AS database_now,
            (lease_expires_at IS NOT NULL) AS recovered_expired_lease
          FROM byline_recurring_tasks
          WHERE name = ${params.name}
            AND next_run_at <= CURRENT_TIMESTAMP(6)
            AND (lease_expires_at IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP(6))
          FOR UPDATE
        `)) as unknown as [ClaimRow[], unknown]

        const row = selected[0][0]
        if (row === undefined) return null

        const leaseToken = randomUUID()
        const result = await tx.execute(sql`
          UPDATE byline_recurring_tasks SET
            lease_token = ${leaseToken},
            lease_owner = ${params.owner.slice(0, LEASE_OWNER_MAX_LENGTH)},
            lease_expires_at = TIMESTAMPADD(
              MICROSECOND,
              ${params.leaseMs} * 1000,
              CURRENT_TIMESTAMP(6)
            ),
            last_started_at = CURRENT_TIMESTAMP(6),
            last_status = 'running',
            updated_at = CURRENT_TIMESTAMP(6)
          WHERE name = ${params.name}
        `)
        if (affectedRowCount(result) !== 1) {
          throw new Error(`scheduler store: locked claim row '${params.name}' disappeared`)
        }

        return {
          name: row.name,
          leaseToken,
          scheduledFor: requiredDate(row.scheduled_for, 'scheduled_for'),
          databaseNow: requiredDate(row.database_now, 'database_now'),
          recoveredExpiredLease: Boolean(row.recovered_expired_lease),
        }
      },
      { isolationLevel: 'read committed' }
    )
  }

  /**
   * Do not add an expiry predicate: expiry makes a row claimable but does not
   * invalidate the current token until another claimant replaces it.
   */
  async renew(params: { name: string; leaseToken: string; leaseMs: number }): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE byline_recurring_tasks SET
        lease_expires_at = TIMESTAMPADD(
          MICROSECOND,
          ${params.leaseMs} * 1000,
          CURRENT_TIMESTAMP(6)
        ),
        updated_at = CURRENT_TIMESTAMP(6)
      WHERE name = ${params.name} AND lease_token = ${params.leaseToken}
    `)
    return affectedRowCount(result) === 1
  }

  /** Complete a token-matched run and schedule from the persisted cadence. */
  async complete(params: {
    name: string
    leaseToken: string
    durationMs: number
    workRemaining: boolean
  }): Promise<boolean> {
    const nextRunAt = params.workRemaining
      ? sql`CURRENT_TIMESTAMP(6)`
      : sql`TIMESTAMPADD(MICROSECOND, interval_ms * 1000, CURRENT_TIMESTAMP(6))`
    const result = await this.db.execute(sql`
      UPDATE byline_recurring_tasks SET
        last_succeeded_at = CURRENT_TIMESTAMP(6),
        last_status = 'succeeded',
        last_duration_ms = ${params.durationMs},
        consecutive_failures = 0,
        last_error = NULL,
        lease_token = NULL,
        lease_owner = NULL,
        lease_expires_at = NULL,
        next_run_at = ${nextRunAt},
        updated_at = CURRENT_TIMESTAMP(6)
      WHERE name = ${params.name} AND lease_token = ${params.leaseToken}
    `)
    return affectedRowCount(result) === 1
  }

  /**
   * Record a token-matched failure with 1, 2, 4, 8, then 15 minute backoff.
   * MySQL evaluates single-table UPDATE assignments from left to right, so
   * `next_run_at` intentionally reads the old `consecutive_failures` before
   * the following assignment increments it.
   */
  async fail(params: {
    name: string
    leaseToken: string
    durationMs: number
    error: string
  }): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE byline_recurring_tasks SET
        last_failed_at = CURRENT_TIMESTAMP(6),
        last_status = 'failed',
        last_duration_ms = ${params.durationMs},
        last_error = ${params.error.slice(0, LAST_ERROR_MAX_LENGTH)},
        lease_token = NULL,
        lease_owner = NULL,
        lease_expires_at = NULL,
        next_run_at = TIMESTAMPADD(
          SECOND,
          LEAST(
            60 * CAST(POWER(2, LEAST(consecutive_failures, 4)) AS UNSIGNED),
            ${MAX_BACKOFF_SECONDS}
          ),
          CURRENT_TIMESTAMP(6)
        ),
        consecutive_failures = consecutive_failures + 1,
        updated_at = CURRENT_TIMESTAMP(6)
      WHERE name = ${params.name} AND lease_token = ${params.leaseToken}
    `)
    return affectedRowCount(result) === 1
  }

  /** Return selected health rows, or every row when names is omitted. */
  async health(names?: readonly string[]): Promise<RecurringTaskHealth[]> {
    if (names?.length === 0) return []

    const whereClause =
      names === undefined
        ? sql``
        : sql`WHERE name IN (${sql.join(
            names.map((name) => sql`${name}`),
            sql`, `
          )})`
    const result = (await this.db.execute(sql`
      SELECT
        name,
        interval_ms,
        next_run_at,
        last_status,
        last_started_at,
        last_succeeded_at,
        last_failed_at,
        last_duration_ms,
        consecutive_failures,
        last_error,
        (lease_expires_at IS NOT NULL AND lease_expires_at <= CURRENT_TIMESTAMP(6)) AS lease_expired,
        CURRENT_TIMESTAMP(6) AS database_now
      FROM byline_recurring_tasks
      ${whereClause}
      ORDER BY name
    `)) as unknown as [HealthRow[], unknown]

    return result[0].map((row) => ({
      name: row.name,
      intervalMs: Number(row.interval_ms),
      nextRunAt: requiredDate(row.next_run_at, 'next_run_at'),
      lastStatus: row.last_status,
      lastStartedAt: toDate(row.last_started_at, 'last_started_at'),
      lastSucceededAt: toDate(row.last_succeeded_at, 'last_succeeded_at'),
      lastFailedAt: toDate(row.last_failed_at, 'last_failed_at'),
      lastDurationMs: row.last_duration_ms === null ? null : Number(row.last_duration_ms),
      consecutiveFailures: Number(row.consecutive_failures),
      lastError: row.last_error,
      leaseExpired: Boolean(row.lease_expired),
      databaseNow: requiredDate(row.database_now, 'database_now'),
    }))
  }
}

export function createSchedulerStore(db: DatabaseConnection): ISchedulerStore {
  return new SchedulerStore(db)
}
