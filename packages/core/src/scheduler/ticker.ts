/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { defaultOwner, runDueTasksWithDeps } from './run-due-tasks.js'
import type { BylineCore } from '../core.js'
import type { BylineLogger } from '../logger/index.js'
import type { ISchedulerStore, RecurringTaskDefinition } from './types.js'

const DEFAULT_TICK_INTERVAL_MS = 60_000
const DEFAULT_STARTUP_JITTER_MS = 30_000
const DEFAULT_SHUTDOWN_GRACE_MS = 5_000

export interface SchedulerOptions {
  tickIntervalMs?: number
  startupJitterMs?: number
  concurrency?: number
  owner?: string
  shutdownGraceMs?: number
}

export interface SchedulerController {
  stop(): Promise<void>
}

interface SchedulerDeps extends SchedulerOptions {
  store: ISchedulerStore
  tasks: readonly RecurringTaskDefinition[]
  owner: string
  logger: BylineLogger
}

function assertWholeNumber(params: {
  value: number
  name: string
  allowZero?: boolean
  unit?: string
}): void {
  const minimum = params.allowZero === true ? 0 : 1
  if (!Number.isSafeInteger(params.value) || params.value < minimum) {
    throw new Error(
      `${params.name} must be a ${params.allowZero === true ? 'non-negative' : 'positive'} ` +
        `whole number${params.unit ?? ''} (received ${params.value})`
    )
  }
}

function unrefTimer(handle: ReturnType<typeof setTimeout>): void {
  handle.unref?.()
}

function startupDelay(maximumMs: number): number {
  if (maximumMs === 0) return 0
  return Math.min(maximumMs, Math.floor(Math.random() * (maximumMs + 1)))
}

function waitForTickOrGrace(activeTick: Promise<void>, graceMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(graceTimer)
      resolve()
    }
    const graceTimer = setTimeout(finish, graceMs)
    unrefTimer(graceTimer)
    void activeTick.then(finish, finish)
  })
}

/**
 * Dependency-injected ticker used by unit tests. It is intentionally absent
 * from the `@byline/core/scheduler` barrel.
 */
export function startSchedulerWithDeps(params: SchedulerDeps): SchedulerController {
  const tickIntervalMs = params.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS
  const startupJitterMs = params.startupJitterMs ?? DEFAULT_STARTUP_JITTER_MS
  const shutdownGraceMs = params.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS

  assertWholeNumber({ value: tickIntervalMs, name: 'tickIntervalMs', unit: ' of milliseconds' })
  assertWholeNumber({
    value: startupJitterMs,
    name: 'startupJitterMs',
    allowZero: true,
    unit: ' of milliseconds',
  })
  assertWholeNumber({
    value: shutdownGraceMs,
    name: 'shutdownGraceMs',
    allowZero: true,
    unit: ' of milliseconds',
  })
  if (params.concurrency !== undefined) {
    assertWholeNumber({ value: params.concurrency, name: 'concurrency' })
  }

  const owner = params.owner.slice(0, 255)
  const controller = new AbortController()
  let stopped = false
  let nextTimeout: ReturnType<typeof setTimeout> | undefined
  let activeTick: Promise<void> | undefined

  const schedule = (delayMs: number) => {
    if (stopped) return
    nextTimeout = setTimeout(() => {
      nextTimeout = undefined
      if (stopped) return

      const currentTick = (async () => {
        try {
          await runDueTasksWithDeps({
            store: params.store,
            tasks: params.tasks,
            owner,
            logger: params.logger,
            signal: controller.signal,
            concurrency: params.concurrency,
          })
        } catch (error) {
          params.logger.error(
            {
              event: 'scheduler.tick-error',
              owner,
              durationMs: 0,
              err: error,
            },
            'Recurring task scheduler tick failed'
          )
        }
      })()

      activeTick = currentTick
      const finishTick = () => {
        if (activeTick === currentTick) activeTick = undefined
        if (!stopped) schedule(tickIntervalMs)
      }
      void currentTick.then(finishTick, finishTick)
    }, delayMs)
    unrefTimer(nextTimeout)
  }

  schedule(startupDelay(startupJitterMs))

  return {
    stop: () => {
      if (stopped) return Promise.resolve()
      stopped = true
      if (nextTimeout !== undefined) {
        clearTimeout(nextTimeout)
        nextTimeout = undefined
      }
      controller.abort(new Error('Recurring task scheduler stopped'))

      const tickAtStop = activeTick
      if (tickAtStop === undefined) return Promise.resolve()
      return waitForTickOrGrace(tickAtStop, shutdownGraceMs)
    },
  }
}

/** Start the opt-in, in-process ticker over the definitions vetted at boot. */
export function startBylineScheduler(
  core: BylineCore,
  options: SchedulerOptions = {}
): SchedulerController {
  const store = core.db.scheduler
  if (store === undefined) {
    throw new Error(
      'startBylineScheduler() requires a database adapter with the scheduler capability. ' +
        'Use a canonical adapter (@byline/db-postgres or @byline/db-mysql).'
    )
  }

  return startSchedulerWithDeps({
    store,
    tasks: core.recurringTasks,
    owner: options.owner ?? defaultOwner(),
    logger: core.logger,
    tickIntervalMs: options.tickIntervalMs,
    startupJitterMs: options.startupJitterMs,
    concurrency: options.concurrency,
    shutdownGraceMs: options.shutdownGraceMs,
  })
}
