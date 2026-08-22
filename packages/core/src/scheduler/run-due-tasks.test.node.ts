/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it, vi } from 'vitest'

import { defineRecurringTask } from './define-recurring-task.js'
import { runDueTasks, runDueTasksWithDeps } from './run-due-tasks.js'
import type { BylineCore } from '../core.js'
import type { BylineLogger } from '../logger/index.js'
import type { ClaimedRecurringTask, ISchedulerStore } from './types.js'

const silentLogger: BylineLogger = {
  log: vi.fn(),
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
}

function claimed(name: string, recoveredExpiredLease = false): ClaimedRecurringTask {
  return {
    name,
    leaseToken: `token-${name}`,
    scheduledFor: new Date('2026-08-22T00:00:00Z'),
    databaseNow: new Date('2026-08-22T00:00:01Z'),
    recoveredExpiredLease,
  }
}

function fakeStore(overrides: Partial<ISchedulerStore> = {}): ISchedulerStore {
  return {
    reconcile: vi.fn(async () => {}),
    claim: vi.fn(async () => null),
    renew: vi.fn(async () => true),
    complete: vi.fn(async () => true),
    fail: vi.fn(async () => true),
    health: vi.fn(async () => []),
    ...overrides,
  }
}

function task(name: string, run: () => Promise<void> = async () => {}) {
  return defineRecurringTask({
    name,
    intervalMs: 60_000,
    leaseMs: 60_000,
    run,
  })
}

describe('runDueTasks', () => {
  it('does nothing when no task is due', async () => {
    const run = vi.fn(async () => {})
    const store = fakeStore()

    const summary = await runDueTasksWithDeps({
      store,
      tasks: [task('a', run)],
      owner: 'test',
      logger: silentLogger,
    })

    expect(run).not.toHaveBeenCalled()
    expect(summary).toEqual({ claimed: 0, succeeded: 0, failed: 0, aborted: 0 })
  })

  it('reconciles the registered definitions before attempting claims', async () => {
    const operations: string[] = []
    const store = fakeStore({
      reconcile: vi.fn(async (definitions) => {
        operations.push('reconcile')
        expect(definitions).toEqual([{ name: 'a', intervalMs: 60_000 }])
      }),
      claim: vi.fn(async () => {
        operations.push('claim')
        return null
      }),
    })

    await runDueTasksWithDeps({
      store,
      tasks: [task('a')],
      owner: 'test',
      logger: silentLogger,
    })

    expect(operations).toEqual(['reconcile', 'claim'])
  })

  it('rejects a pass when reconciliation fails so external cron observes the outage', async () => {
    const error = new Error('reconcile unavailable')
    const logger = { ...silentLogger, error: vi.fn() }
    const store = fakeStore({
      reconcile: vi.fn(async () => {
        throw error
      }),
    })

    await expect(
      runDueTasksWithDeps({
        store,
        tasks: [task('a')],
        owner: 'test',
        logger,
      })
    ).rejects.toBe(error)
    expect(store.claim).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'scheduler.reconcile-error', err: error }),
      expect.any(String)
    )
  })

  it('runs a claimed task and completes it', async () => {
    const run = vi.fn(async () => {})
    const store = fakeStore({ claim: vi.fn(async () => claimed('a')) })

    const summary = await runDueTasksWithDeps({
      store,
      tasks: [task('a', run)],
      owner: 'test',
      logger: silentLogger,
    })

    expect(run).toHaveBeenCalledTimes(1)
    expect(store.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'a',
        leaseToken: 'token-a',
        durationMs: expect.any(Number),
        workRemaining: false,
      })
    )
    expect(summary).toEqual({ claimed: 1, succeeded: 1, failed: 0, aborted: 0 })
  })

  it('passes workRemaining through to complete', async () => {
    const store = fakeStore({ claim: vi.fn(async () => claimed('a')) })
    const recurringTask = defineRecurringTask({
      name: 'a',
      intervalMs: 3_600_000,
      leaseMs: 60_000,
      run: async () => ({ workRemaining: true }),
    })

    await runDueTasksWithDeps({
      store,
      tasks: [recurringTask],
      owner: 'test',
      logger: silentLogger,
    })

    expect(store.complete).toHaveBeenCalledWith(expect.objectContaining({ workRemaining: true }))
  })

  it('sanitizes and bounds a handler error before recording failure', async () => {
    const error = new Error(`boom\u0000${'x'.repeat(3_000)}\nstack-like detail`)
    const logger = { ...silentLogger, error: vi.fn() }
    const store = fakeStore({ claim: vi.fn(async () => claimed('a')) })
    const recurringTask = task('a', async () => {
      throw error
    })

    const summary = await runDueTasksWithDeps({
      store,
      tasks: [recurringTask],
      owner: 'test',
      logger,
    })

    const failure = vi.mocked(store.fail).mock.calls[0]?.[0]
    expect(failure?.error).toHaveLength(2_048)
    expect(failure?.error).not.toContain('\u0000')
    expect(failure?.error).not.toContain('\r')
    expect(failure?.error).not.toContain('\n')
    expect(failure?.error).not.toContain('stack-like detail')
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: error, name: 'a', owner: 'test' }),
      expect.any(String)
    )
    expect(summary).toEqual({ claimed: 1, succeeded: 0, failed: 1, aborted: 0 })
  })

  it('continues other tasks when a handler fails', async () => {
    const ranB = vi.fn(async () => {})
    const store = fakeStore({ claim: vi.fn(async ({ name }) => claimed(name)) })
    const tasks = [
      task('a', async () => {
        throw new Error('boom')
      }),
      task('b', ranB),
    ]

    const summary = await runDueTasksWithDeps({
      store,
      tasks,
      owner: 'test',
      logger: silentLogger,
    })

    expect(ranB).toHaveBeenCalledTimes(1)
    expect(summary).toEqual({ claimed: 2, succeeded: 1, failed: 1, aborted: 0 })
  })

  it('contains and counts store failures without rejecting the pass', async () => {
    const ranB = vi.fn(async () => {})
    const store = fakeStore({
      claim: vi.fn(async ({ name }) => {
        if (name === 'a') throw new Error('db down')
        return claimed(name)
      }),
    })

    await expect(
      runDueTasksWithDeps({
        store,
        tasks: [task('a'), task('b', ranB)],
        owner: 'test',
        logger: silentLogger,
      })
    ).resolves.toEqual({ claimed: 1, succeeded: 1, failed: 1, aborted: 0 })
    expect(ranB).toHaveBeenCalledTimes(1)
  })

  it('contains a completion-store rejection without attempting fail', async () => {
    const store = fakeStore({
      claim: vi.fn(async () => claimed('a')),
      complete: vi.fn(async () => {
        throw new Error('completion unavailable')
      }),
    })

    await expect(
      runDueTasksWithDeps({
        store,
        tasks: [task('a')],
        owner: 'test',
        logger: silentLogger,
      })
    ).resolves.toEqual({ claimed: 1, succeeded: 0, failed: 1, aborted: 0 })
    expect(store.fail).not.toHaveBeenCalled()
  })

  it('contains a failure-store rejection without rejecting the pass', async () => {
    const store = fakeStore({
      claim: vi.fn(async () => claimed('a')),
      fail: vi.fn(async () => {
        throw new Error('failure recorder unavailable')
      }),
    })

    await expect(
      runDueTasksWithDeps({
        store,
        tasks: [
          task('a', async () => {
            throw new Error('handler failed')
          }),
        ],
        owner: 'test',
        logger: silentLogger,
      })
    ).resolves.toEqual({ claimed: 1, succeeded: 0, failed: 1, aborted: 0 })
  })

  it('aborts before heartbeat rejects and never finalizes a known-lost lease', async () => {
    const store = fakeStore({
      claim: vi.fn(async () => claimed('a')),
      renew: vi.fn(async () => false),
    })
    let abortedWhenHeartbeatRejected = false
    const recurringTask = defineRecurringTask({
      name: 'a',
      intervalMs: 3_600_000,
      leaseMs: 60_000,
      run: async (context) => {
        try {
          await context.heartbeat()
        } catch {
          abortedWhenHeartbeatRejected = context.signal.aborted
        }
      },
    })

    const summary = await runDueTasksWithDeps({
      store,
      tasks: [recurringTask],
      owner: 'test',
      logger: silentLogger,
    })

    expect(abortedWhenHeartbeatRejected).toBe(true)
    expect(store.complete).not.toHaveBeenCalled()
    expect(store.fail).not.toHaveBeenCalled()
    expect(summary).toEqual({ claimed: 1, succeeded: 0, failed: 1, aborted: 0 })
  })

  it('aborts and avoids finalization when the heartbeat store call rejects', async () => {
    const store = fakeStore({
      claim: vi.fn(async () => claimed('a')),
      renew: vi.fn(async () => {
        throw new Error('renew unavailable')
      }),
    })
    let heartbeatRejectedAfterAbort = false
    const recurringTask = defineRecurringTask({
      name: 'a',
      intervalMs: 60_000,
      leaseMs: 60_000,
      run: async (context) => {
        try {
          await context.heartbeat()
        } catch {
          heartbeatRejectedAfterAbort = context.signal.aborted
        }
      },
    })

    await expect(
      runDueTasksWithDeps({
        store,
        tasks: [recurringTask],
        owner: 'test',
        logger: silentLogger,
      })
    ).resolves.toEqual({ claimed: 1, succeeded: 0, failed: 1, aborted: 0 })
    expect(heartbeatRejectedAfterAbort).toBe(true)
    expect(store.complete).not.toHaveBeenCalled()
    expect(store.fail).not.toHaveBeenCalled()
  })

  it('does not finalize after the incoming signal aborts an active handler', async () => {
    const controller = new AbortController()
    const store = fakeStore({ claim: vi.fn(async () => claimed('a')) })
    const recurringTask = defineRecurringTask({
      name: 'a',
      intervalMs: 60_000,
      leaseMs: 60_000,
      run: async (context) => {
        controller.abort()
        expect(context.signal.aborted).toBe(true)
      },
    })

    const summary = await runDueTasksWithDeps({
      store,
      tasks: [recurringTask],
      owner: 'test',
      logger: silentLogger,
      signal: controller.signal,
    })

    expect(store.complete).not.toHaveBeenCalled()
    expect(store.fail).not.toHaveBeenCalled()
    expect(summary).toEqual({ claimed: 1, succeeded: 0, failed: 0, aborted: 1 })
  })

  it('stops claiming new definitions after the incoming signal aborts', async () => {
    const controller = new AbortController()
    const store = fakeStore({
      claim: vi.fn(async ({ name }) => {
        controller.abort()
        return claimed(name)
      }),
    })

    await runDueTasksWithDeps({
      store,
      tasks: [task('a'), task('b')],
      owner: 'test',
      logger: silentLogger,
      signal: controller.signal,
      concurrency: 1,
    })

    expect(store.claim).toHaveBeenCalledTimes(1)
    expect(store.claim).toHaveBeenCalledWith({ name: 'a', leaseMs: 60_000, owner: 'test' })
  })

  it('defaults to two concurrent handlers while still attempting every definition', async () => {
    let active = 0
    let maximumActive = 0
    const releases: Array<() => void> = []
    const store = fakeStore({ claim: vi.fn(async ({ name }) => claimed(name)) })
    const tasks = ['a', 'b', 'c', 'd'].map((name) =>
      task(
        name,
        () =>
          new Promise<void>((resolve) => {
            active += 1
            maximumActive = Math.max(maximumActive, active)
            releases.push(() => {
              active -= 1
              resolve()
            })
          })
      )
    )

    const pass = runDueTasksWithDeps({
      store,
      tasks,
      owner: 'test',
      logger: silentLogger,
    })
    await vi.waitFor(() => expect(releases).toHaveLength(2))
    releases.shift()?.()
    await vi.waitFor(() => expect(releases).toHaveLength(2))
    releases.shift()?.()
    await vi.waitFor(() => expect(releases).toHaveLength(2))
    releases.splice(0).forEach((release) => {
      release()
    })

    await expect(pass).resolves.toEqual({ claimed: 4, succeeded: 4, failed: 0, aborted: 0 })
    expect(maximumActive).toBe(2)
    expect(store.claim).toHaveBeenCalledTimes(4)
  })

  it('treats a rejected completion fence as lease loss without calling fail', async () => {
    const store = fakeStore({
      claim: vi.fn(async () => claimed('a')),
      complete: vi.fn(async () => false),
    })

    const summary = await runDueTasksWithDeps({
      store,
      tasks: [task('a')],
      owner: 'test',
      logger: silentLogger,
    })

    expect(store.fail).not.toHaveBeenCalled()
    expect(summary).toEqual({ claimed: 1, succeeded: 0, failed: 1, aborted: 0 })
  })

  it('logs recovery when a claim takes over an expired lease', async () => {
    const logger = { ...silentLogger, warn: vi.fn() }
    const store = fakeStore({ claim: vi.fn(async () => claimed('a', true)) })

    await runDueTasksWithDeps({
      store,
      tasks: [task('a')],
      owner: 'test',
      logger,
    })

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'scheduler.recovered-expired-lease', name: 'a' }),
      expect.any(String)
    )
  })

  it('uses only core.recurringTasks and reports a missing scheduler capability', async () => {
    const coreRun = vi.fn(async () => {})
    const injectedRun = vi.fn(async () => {})
    const store = fakeStore({ claim: vi.fn(async ({ name }) => claimed(name)) })
    const core = {
      db: { scheduler: store },
      recurringTasks: [task('core-task', coreRun)],
      logger: silentLogger,
    } as unknown as BylineCore

    await runDueTasks(core, { owner: 'test', tasks: [task('injected-task', injectedRun)] } as never)

    expect(coreRun).toHaveBeenCalledTimes(1)
    expect(injectedRun).not.toHaveBeenCalled()

    await expect(
      runDueTasks({ ...core, db: {} } as unknown as BylineCore, { owner: 'test' })
    ).rejects.toThrow(/scheduler capability/i)
  })
})
