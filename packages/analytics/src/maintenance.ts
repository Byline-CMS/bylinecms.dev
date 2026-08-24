/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { defineRecurringTask, type RecurringTaskDefinition } from '@byline/core'

import { ANALYTICS_EVENT_RETENTION_DAYS } from './config.js'
import {
  addAnalyticsDays,
  analyticsDay,
  compareAnalyticsDays,
  startOfAnalyticsDay,
} from './date.js'
import type { Analytics } from './analytics.js'

export interface AnalyticsMaintenanceOptions {
  analytics: Analytics
  /** Defaults to seven complete days per scheduler invocation. */
  maxDaysPerRun?: number
  /** Test seam. */
  now?: () => Date
}

export interface AnalyticsMaintenanceResult {
  processedDays: string[]
  workRemaining: boolean
}

export async function runAnalyticsMaintenance(
  options: AnalyticsMaintenanceOptions,
  context?: { signal?: AbortSignal; heartbeat?: () => Promise<void> }
): Promise<AnalyticsMaintenanceResult> {
  const now = (options.now ?? (() => new Date()))()
  // The recurring task also acts as the daily metrics flush when ingest is idle.
  options.analytics.metrics.snapshot(now)
  const yesterday = addAnalyticsDays(analyticsDay(now), -1)
  const maxDays = validateMaxDays(options.maxDaysPerRun ?? 7)
  const store = options.analytics.store
  const cursor = await store.getRollupCursor()
  const earliest = cursor == null ? await store.getEarliestEventDay() : null
  let nextDay = cursor == null ? (earliest ?? yesterday) : addAnalyticsDays(cursor, 1)
  const processedDays: string[] = []

  while (
    compareAnalyticsDays(nextDay, yesterday) <= 0 &&
    processedDays.length < maxDays &&
    context?.signal?.aborted !== true
  ) {
    await store.rebuildDay({
      day: nextDay,
      pathCardinalityCap: options.analytics.config.pathCardinalityCap,
      referrerCardinalityCap: options.analytics.config.referrerCardinalityCap,
      advanceCursor: true,
    })
    processedDays.push(nextDay)
    nextDay = addAnalyticsDays(nextDay, 1)
    await context?.heartbeat?.()
  }

  const workRemaining = compareAnalyticsDays(nextDay, yesterday) <= 0
  if (!workRemaining) {
    const today = analyticsDay(now)
    await store.prune({
      eventsBefore: startOfAnalyticsDay(addAnalyticsDays(today, -ANALYTICS_EVENT_RETENTION_DAYS)),
      saltsBefore: addAnalyticsDays(today, -1),
      pathAggregatesBefore:
        options.analytics.config.pathRetentionDays == null
          ? null
          : addAnalyticsDays(today, -options.analytics.config.pathRetentionDays),
      referrerAggregatesBefore:
        options.analytics.config.referrerRetentionDays == null
          ? null
          : addAnalyticsDays(today, -options.analytics.config.referrerRetentionDays),
    })
  }

  return { processedDays, workRemaining }
}

export interface DefineAnalyticsRollupTaskOptions extends AnalyticsMaintenanceOptions {
  intervalMs?: number
  leaseMs?: number
}

export function defineAnalyticsRollupTask(
  options: DefineAnalyticsRollupTaskOptions
): RecurringTaskDefinition {
  return defineRecurringTask({
    name: 'analytics.rollup',
    intervalMs: options.intervalMs ?? 60 * 60_000,
    leaseMs: options.leaseMs ?? 5 * 60_000,
    async run(context) {
      const result = await runAnalyticsMaintenance(options, context)
      context.logger.info(
        { processedDays: result.processedDays.length, workRemaining: result.workRemaining },
        '[analytics] rollup maintenance completed'
      )
      return { workRemaining: result.workRemaining }
    },
  })
}

function validateMaxDays(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('analytics maxDaysPerRun must be a positive integer')
  }
  return value
}
