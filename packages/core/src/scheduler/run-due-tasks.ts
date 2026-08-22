/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { hostname } from 'node:os'

import type { BylineCore } from '../core.js'
import type { BylineLogger } from '../logger/index.js'
import type {
  ClaimedRecurringTask,
  ISchedulerStore,
  RecurringTaskDefinition,
  RecurringTaskResult,
} from './types.js'

const DEFAULT_CONCURRENCY = 2
const MAX_OWNER_LENGTH = 255
const MAX_STORED_ERROR_LENGTH = 2_048

export interface RunDueTasksOptions {
  signal?: AbortSignal
  concurrency?: number
  owner?: string
}

export interface RunDueTasksSummary {
  claimed: number
  succeeded: number
  failed: number
  aborted: number
}

interface RunDueTasksDeps {
  store: ISchedulerStore
  tasks: readonly RecurringTaskDefinition[]
  owner: string
  logger: BylineLogger
  signal?: AbortSignal
  concurrency?: number
}

type ActiveRunState = 'active' | 'aborted' | 'heartbeat-error' | 'lease-lost'

class LeaseLostError extends Error {
  constructor(taskName: string) {
    super(`recurring task '${taskName}' lost its lease`)
    this.name = 'LeaseLostError'
  }
}

class HeartbeatError extends Error {
  constructor(taskName: string, cause: unknown) {
    super(`recurring task '${taskName}' could not renew its lease`, { cause })
    this.name = 'HeartbeatError'
  }
}

function normalizeConcurrency(value: number | undefined): number {
  const concurrency = value ?? DEFAULT_CONCURRENCY
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error(
      `scheduler concurrency must be a positive whole number (received ${concurrency})`
    )
  }
  return concurrency
}

function durationSince(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt)
}

/**
 * Store one bounded, single-line message. The complete error object (including
 * its stack, when it is an Error) goes only to the configured logger.
 */
function sanitizeError(error: unknown): string {
  let message: string
  if (error instanceof Error) {
    message = error.message || error.name
  } else {
    try {
      message = typeof error === 'string' ? error : String(error)
    } catch {
      message = 'Unknown recurring task error'
    }
  }

  const newlineIndex = message.indexOf('\n')
  const firstLine = newlineIndex === -1 ? message : message.slice(0, newlineIndex)
  let sanitized = ''
  for (const character of firstLine) {
    const codePoint = character.codePointAt(0) ?? 0
    sanitized += codePoint <= 31 || codePoint === 127 ? ' ' : character
    if (sanitized.length >= MAX_STORED_ERROR_LENGTH) break
  }
  sanitized = sanitized.trim()
  return (sanitized || 'Unknown recurring task error').slice(0, MAX_STORED_ERROR_LENGTH)
}

function logLostLease(params: {
  logger: BylineLogger
  name: string
  owner: string
  durationMs: number
  phase: 'heartbeat' | 'complete' | 'fail'
}): void {
  params.logger.warn(
    {
      event: 'scheduler.lost-lease',
      name: params.name,
      owner: params.owner,
      durationMs: params.durationMs,
      phase: params.phase,
    },
    'Recurring task lost its lease'
  )
}

async function runClaimedTask(params: {
  store: ISchedulerStore
  task: RecurringTaskDefinition
  claim: ClaimedRecurringTask
  owner: string
  logger: BylineLogger
  signal?: AbortSignal
  summary: RunDueTasksSummary
}): Promise<void> {
  const { store, task, claim, owner, logger, signal, summary } = params
  const controller = new AbortController()
  let state: ActiveRunState = 'active'
  const startedAt = Date.now()

  const abortFromParent = () => {
    if (state !== 'active') return
    state = 'aborted'
    controller.abort(signal?.reason)
  }

  if (signal?.aborted) abortFromParent()
  else signal?.addEventListener('abort', abortFromParent, { once: true })

  if (claim.recoveredExpiredLease) {
    logger.warn(
      {
        event: 'scheduler.recovered-expired-lease',
        name: task.name,
        owner,
        durationMs: 0,
      },
      'Recurring task recovered an expired lease'
    )
  }

  logger.info(
    { event: 'scheduler.start', name: task.name, owner, durationMs: 0 },
    'Recurring task started'
  )

  let result: RecurringTaskResult | null = null
  let handlerRejected = false
  let handlerError: unknown

  try {
    if (state === 'active') {
      const taskResult = await task.run({
        taskName: task.name,
        scheduledFor: claim.scheduledFor,
        signal: controller.signal,
        logger,
        heartbeat: async () => {
          if (state === 'lease-lost') throw new LeaseLostError(task.name)
          if (state === 'heartbeat-error') {
            throw new HeartbeatError(task.name, controller.signal.reason)
          }
          if (state === 'aborted') {
            throw new Error(`recurring task '${task.name}' was aborted`)
          }

          let renewed: boolean
          try {
            renewed = await store.renew({
              name: task.name,
              leaseToken: claim.leaseToken,
              leaseMs: task.leaseMs,
            })
          } catch (error) {
            const heartbeatError = new HeartbeatError(task.name, error)
            state = 'heartbeat-error'
            controller.abort(heartbeatError)
            logger.error(
              {
                event: 'scheduler.store-error',
                operation: 'renew',
                name: task.name,
                owner,
                durationMs: durationSince(startedAt),
                err: error,
              },
              'Recurring task heartbeat failed'
            )
            throw heartbeatError
          }

          if (!renewed) {
            const leaseLostError = new LeaseLostError(task.name)
            state = 'lease-lost'
            controller.abort(leaseLostError)
            logLostLease({
              logger,
              name: task.name,
              owner,
              durationMs: durationSince(startedAt),
              phase: 'heartbeat',
            })
            throw leaseLostError
          }
        },
      })
      result = taskResult ?? null
    }
  } catch (error) {
    handlerRejected = true
    handlerError = error
  } finally {
    signal?.removeEventListener('abort', abortFromParent)
  }

  const durationMs = durationSince(startedAt)

  // Once shutdown, an uncertain heartbeat, or a token mismatch aborts a run,
  // leave its row alone. In particular, never issue a known-stale fail write:
  // the current owner is now another runner and the fence must remain intact.
  if (state !== 'active') {
    if (state === 'aborted') {
      summary.aborted += 1
      logger.warn(
        { event: 'scheduler.aborted', name: task.name, owner, durationMs },
        'Recurring task aborted before finalization'
      )
    } else {
      summary.failed += 1
    }
    return
  }

  if (handlerRejected) {
    summary.failed += 1
    logger.error(
      {
        event: 'scheduler.failure',
        name: task.name,
        owner,
        durationMs,
        err: handlerError,
      },
      'Recurring task failed'
    )

    try {
      const failed = await store.fail({
        name: task.name,
        leaseToken: claim.leaseToken,
        durationMs,
        error: sanitizeError(handlerError),
      })
      if (!failed) {
        logLostLease({ logger, name: task.name, owner, durationMs, phase: 'fail' })
      }
    } catch (error) {
      logger.error(
        {
          event: 'scheduler.store-error',
          operation: 'fail',
          name: task.name,
          owner,
          durationMs,
          err: error,
        },
        'Recurring task failure could not be recorded'
      )
    }
    return
  }

  try {
    const completed = await store.complete({
      name: task.name,
      leaseToken: claim.leaseToken,
      durationMs,
      workRemaining: result?.workRemaining === true,
    })
    if (!completed) {
      summary.failed += 1
      logLostLease({ logger, name: task.name, owner, durationMs, phase: 'complete' })
      return
    }

    summary.succeeded += 1
    logger.info(
      {
        event: 'scheduler.success',
        name: task.name,
        owner,
        durationMs,
        workRemaining: result?.workRemaining === true,
      },
      'Recurring task succeeded'
    )
  } catch (error) {
    summary.failed += 1
    logger.error(
      {
        event: 'scheduler.store-error',
        operation: 'complete',
        name: task.name,
        owner,
        durationMs,
        err: error,
      },
      'Recurring task completion could not be recorded'
    )
  }
}

/** A bounded, non-secret diagnostic label. Correctness never depends on it. */
export function defaultOwner(): string {
  return `${hostname()}:${process.pid}`.slice(0, MAX_OWNER_LENGTH)
}

/**
 * Dependency-injected implementation used by the ticker and unit tests. It is
 * intentionally absent from the `@byline/core/scheduler` barrel.
 */
export async function runDueTasksWithDeps(params: RunDueTasksDeps): Promise<RunDueTasksSummary> {
  const concurrency = normalizeConcurrency(params.concurrency)
  const owner = params.owner.slice(0, MAX_OWNER_LENGTH)
  const summary: RunDueTasksSummary = { claimed: 0, succeeded: 0, failed: 0, aborted: 0 }
  let nextTaskIndex = 0

  try {
    await params.store.reconcile(params.tasks.map(({ name, intervalMs }) => ({ name, intervalMs })))
  } catch (error) {
    params.logger.error(
      {
        event: 'scheduler.reconcile-error',
        owner,
        durationMs: 0,
        err: error,
      },
      'Recurring task definitions could not be reconciled'
    )
    throw error
  }

  const takeNextTask = (): RecurringTaskDefinition | undefined => {
    if (params.signal?.aborted) return undefined
    const task = params.tasks[nextTaskIndex]
    nextTaskIndex += 1
    return task
  }

  const worker = async () => {
    for (let task = takeNextTask(); task !== undefined; task = takeNextTask()) {
      let claim: ClaimedRecurringTask | null
      try {
        claim = await params.store.claim({ name: task.name, leaseMs: task.leaseMs, owner })
      } catch (error) {
        summary.failed += 1
        params.logger.error(
          {
            event: 'scheduler.store-error',
            operation: 'claim',
            name: task.name,
            owner,
            durationMs: 0,
            err: error,
          },
          'Recurring task claim failed'
        )
        continue
      }

      if (claim === null) continue
      summary.claimed += 1
      await runClaimedTask({
        store: params.store,
        task,
        claim,
        owner,
        logger: params.logger,
        signal: params.signal,
        summary,
      })
    }
  }

  const workerCount = Math.min(concurrency, params.tasks.length)
  await Promise.all(Array.from({ length: workerCount }, worker))
  return summary
}

/** Run one claim-and-run pass over the task definitions vetted at core boot. */
export async function runDueTasks(
  core: BylineCore,
  options: RunDueTasksOptions = {}
): Promise<RunDueTasksSummary> {
  const store = core.db.scheduler
  if (store === undefined) {
    throw new Error(
      'runDueTasks() requires a database adapter with the scheduler capability. ' +
        'Use a canonical adapter (@byline/db-postgres or @byline/db-mysql).'
    )
  }

  return runDueTasksWithDeps({
    store,
    tasks: core.recurringTasks,
    owner: options.owner ?? defaultOwner(),
    logger: core.logger,
    signal: options.signal,
    concurrency: options.concurrency,
  })
}
