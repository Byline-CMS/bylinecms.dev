/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { defineRecurringTask } from './define-recurring-task.js'
import { startBylineScheduler, startSchedulerWithDeps } from './ticker.js'
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

function claimed(name: string): ClaimedRecurringTask {
  return {
    name,
    leaseToken: `token-${name}`,
    scheduledFor: new Date('2026-08-22T00:00:00Z'),
    databaseNow: new Date('2026-08-22T00:00:01Z'),
    recoveredExpiredLease: false,
  }
}

function task(name: string, run: () => Promise<void> = async () => {}) {
  return defineRecurringTask({ name, intervalMs: 60_000, leaseMs: 60_000, run })
}

describe('startBylineScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('runs nothing before the startup jitter elapses', async () => {
    vi.mocked(Math.random).mockReturnValue(1)
    const store = fakeStore()
    const controller = startSchedulerWithDeps({
      store,
      tasks: [task('a')],
      owner: 'test',
      logger: silentLogger,
      startupJitterMs: 30_000,
    })

    await vi.advanceTimersByTimeAsync(29_999)
    expect(store.reconcile).not.toHaveBeenCalled()
    expect(store.claim).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(store.reconcile).toHaveBeenCalledTimes(1)
    expect(store.claim).toHaveBeenCalledTimes(1)
    await controller.stop()
  })

  it('unrefs the pending timeout so the ticker alone cannot keep Node alive', async () => {
    vi.useRealTimers()
    const probe = setTimeout(() => {}, 60_000)
    const timerPrototype = Object.getPrototypeOf(probe) as { unref(): void }
    const unref = vi.spyOn(timerPrototype, 'unref')
    clearTimeout(probe)

    const controller = startSchedulerWithDeps({
      store: fakeStore(),
      tasks: [task('a')],
      owner: 'test',
      logger: silentLogger,
      startupJitterMs: 30_000,
    })

    expect(unref).toHaveBeenCalled()
    await controller.stop()
  })

  it('reconciles before claims on every pass', async () => {
    const operations: string[] = []
    const store = fakeStore({
      reconcile: vi.fn(async () => {
        operations.push('reconcile')
      }),
      claim: vi.fn(async () => {
        operations.push('claim')
        return null
      }),
    })
    const controller = startSchedulerWithDeps({
      store,
      tasks: [task('a')],
      owner: 'test',
      logger: silentLogger,
      startupJitterMs: 0,
      tickIntervalMs: 1_000,
    })

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(operations).toEqual(['reconcile', 'claim', 'reconcile', 'claim'])
    await controller.stop()
  })

  it('does not overlap local ticks', async () => {
    let releaseHandler: (() => void) | undefined
    const store = fakeStore({ claim: vi.fn(async () => claimed('a')) })
    const recurringTask = task(
      'a',
      () =>
        new Promise<void>((resolve) => {
          releaseHandler = resolve
        })
    )
    const controller = startSchedulerWithDeps({
      store,
      tasks: [recurringTask],
      owner: 'test',
      logger: silentLogger,
      startupJitterMs: 0,
      tickIntervalMs: 1_000,
    })

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(store.reconcile).toHaveBeenCalledTimes(1)
    expect(store.claim).toHaveBeenCalledTimes(1)

    releaseHandler?.()
    await vi.advanceTimersByTimeAsync(0)
    await controller.stop()
  })

  it('stop prevents another tick and is idempotent', async () => {
    const store = fakeStore()
    const controller = startSchedulerWithDeps({
      store,
      tasks: [task('a')],
      owner: 'test',
      logger: silentLogger,
      startupJitterMs: 0,
      tickIntervalMs: 1_000,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(store.claim).toHaveBeenCalledTimes(1)

    await controller.stop()
    await expect(controller.stop()).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(store.claim).toHaveBeenCalledTimes(1)
  })

  it('stop aborts an in-flight handler without recording failure', async () => {
    let handlerSignal: AbortSignal | undefined
    const store = fakeStore({ claim: vi.fn(async () => claimed('a')) })
    const recurringTask = defineRecurringTask({
      name: 'a',
      intervalMs: 60_000,
      leaseMs: 60_000,
      run: async (context) => {
        handlerSignal = context.signal
        await new Promise<void>((resolve) => {
          context.signal.addEventListener('abort', () => resolve(), { once: true })
        })
      },
    })
    const controller = startSchedulerWithDeps({
      store,
      tasks: [recurringTask],
      owner: 'test',
      logger: silentLogger,
      startupJitterMs: 0,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(handlerSignal?.aborted).toBe(false)

    await controller.stop()

    expect(handlerSignal?.aborted).toBe(true)
    expect(store.complete).not.toHaveBeenCalled()
    expect(store.fail).not.toHaveBeenCalled()
  })

  it('stop resolves after its grace period when a handler ignores abort', async () => {
    const store = fakeStore({ claim: vi.fn(async () => claimed('a')) })
    const controller = startSchedulerWithDeps({
      store,
      tasks: [task('a', () => new Promise<void>(() => {}))],
      owner: 'test',
      logger: silentLogger,
      startupJitterMs: 0,
      shutdownGraceMs: 500,
    })
    await vi.advanceTimersByTimeAsync(0)

    let stopped = false
    const stopping = controller.stop().then(() => {
      stopped = true
    })
    await vi.advanceTimersByTimeAsync(499)
    expect(stopped).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await stopping

    expect(stopped).toBe(true)
    expect(store.complete).not.toHaveBeenCalled()
    expect(store.fail).not.toHaveBeenCalled()
  })

  it('logs a rejected pass and retries on the next tick', async () => {
    const error = new Error('database unavailable')
    const logger = { ...silentLogger, error: vi.fn() }
    const store = fakeStore({
      reconcile: vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(error)
        .mockResolvedValue(undefined),
    })
    const controller = startSchedulerWithDeps({
      store,
      tasks: [task('a')],
      owner: 'test',
      logger,
      startupJitterMs: 0,
      tickIntervalMs: 1_000,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(store.reconcile).toHaveBeenCalledTimes(1)
    expect(store.claim).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(store.reconcile).toHaveBeenCalledTimes(2)
    expect(store.claim).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'scheduler.tick-error', err: error }),
      expect.any(String)
    )
    await controller.stop()
  })

  it('uses core.recurringTasks and fails fast without a scheduler store', async () => {
    const coreRun = vi.fn(async () => {})
    const injectedRun = vi.fn(async () => {})
    const store = fakeStore({ claim: vi.fn(async ({ name }) => claimed(name)) })
    const core = {
      db: { scheduler: store },
      recurringTasks: [task('core-task', coreRun)],
      logger: silentLogger,
    } as unknown as BylineCore
    const controller = startBylineScheduler(core, {
      startupJitterMs: 0,
      owner: 'test',
      tasks: [task('injected-task', injectedRun)],
    } as never)

    await vi.advanceTimersByTimeAsync(0)
    expect(coreRun).toHaveBeenCalledTimes(1)
    expect(injectedRun).not.toHaveBeenCalled()
    await controller.stop()

    expect(() =>
      startBylineScheduler({ ...core, db: {} } as unknown as BylineCore, {
        startupJitterMs: 0,
      })
    ).toThrow(/scheduler capability/i)
  })
})
