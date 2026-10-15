import type { RecurringTaskContext } from '@byline/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAuthMaintenanceTasks } from './auth-maintenance.js'
import type { AdminStore } from '../../store.js'

let store: AdminStore
let context: RecurringTaskContext
const now = new Date('2026-10-16T12:00:00Z')
beforeEach(() => {
  store = {
    authMaintenance: {
      purgeAttempts: vi.fn().mockResolvedValue(0),
      findTerminalLogin: vi.fn().mockResolvedValue(null),
      pruneTerminalLogin: vi.fn(),
      purgeLegacyRefreshTokens: vi.fn().mockResolvedValue(0),
    },
  } as unknown as AdminStore
  store.withSessionLock = vi.fn(async (_id, work) => work(store, null))
  context = {
    taskName: 'test',
    scheduledFor: now,
    signal: new AbortController().signal,
    heartbeat: vi.fn().mockResolvedValue(undefined),
    logger: {},
  } as unknown as RecurringTaskContext
})
afterEach(() => vi.restoreAllMocks())
describe('bounded auth maintenance tasks', () => {
  it('registers three one-minute leased tasks without doing any work', () => {
    const tasks = createAuthMaintenanceTasks(store)
    expect(tasks.map((t) => t.name)).toEqual([
      'auth.maintenance.attempts',
      'auth.maintenance.logins',
      'auth.maintenance.legacy-refresh',
    ])
    expect(tasks.every((t) => t.intervalMs === 60_000 && t.leaseMs === 60_000)).toBe(true)
    expect(store.authMaintenance.purgeAttempts).not.toHaveBeenCalled()
  })
  it('uses separate five-minute and 30-day cutoffs', async () => {
    const tasks = createAuthMaintenanceTasks(store, () => now)
    for (const task of tasks) expect(await task.run(context)).toEqual({ workRemaining: false })
    expect(store.authMaintenance.purgeAttempts).toHaveBeenCalledWith(
      new Date(now.getTime() - 300_000)
    )
    expect(store.authMaintenance.findTerminalLogin).toHaveBeenCalledWith(
      new Date(now.getTime() - 30 * 86_400_000)
    )
    expect(store.authMaintenance.purgeLegacyRefreshTokens).toHaveBeenCalledWith(
      new Date(now.getTime() - 30 * 86_400_000)
    )
  })
  it('stops at 32 full batches and heartbeats before each', async () => {
    vi.mocked(store.authMaintenance.purgeAttempts).mockResolvedValue(100)
    const [task] = createAuthMaintenanceTasks(store)
    expect(await task!.run(context)).toEqual({ workRemaining: true })
    expect(store.authMaintenance.purgeAttempts).toHaveBeenCalledTimes(32)
    expect(context.heartbeat).toHaveBeenCalledTimes(32)
  })
  it('stops when the elapsed-time budget is reached', async () => {
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(30_000)
    vi.mocked(store.authMaintenance.purgeAttempts).mockResolvedValue(100)
    expect(await createAuthMaintenanceTasks(store)[0]!.run(context)).toEqual({
      workRemaining: true,
    })
    expect(store.authMaintenance.purgeAttempts).toHaveBeenCalledOnce()
  })
  it.each(['before', 'heartbeat'])('honours abort %s batch admission', async (phase) => {
    const abort = new AbortController()
    context.signal = abort.signal
    if (phase === 'before') abort.abort(new Error('stopped'))
    else
      vi.mocked(context.heartbeat).mockImplementation(async () => {
        abort.abort(new Error('stopped'))
      })
    await expect(createAuthMaintenanceTasks(store)[0]!.run(context)).rejects.toThrow('stopped')
    expect(store.authMaintenance.purgeAttempts).not.toHaveBeenCalled()
  })
  it('propagates lease loss before cleanup and repository errors to the runner', async () => {
    vi.mocked(context.heartbeat).mockRejectedValueOnce(new Error('lease lost'))
    await expect(createAuthMaintenanceTasks(store)[0]!.run(context)).rejects.toThrow('lease lost')
    expect(store.authMaintenance.purgeAttempts).not.toHaveBeenCalled()
    vi.mocked(store.authMaintenance.purgeAttempts).mockRejectedValue(
      new Error('storage unavailable')
    )
    await expect(createAuthMaintenanceTasks(store)[0]!.run(context)).rejects.toThrow(
      'storage unavailable'
    )
  })
  it('uses the scoped store under the candidate account lock and rescans between batches', async () => {
    const scoped = { authMaintenance: { pruneTerminalLogin: vi.fn() } } as unknown as AdminStore
    vi.mocked(store.withSessionLock).mockImplementation(async (_id, work) => work(scoped, null))
    vi.mocked(store.authMaintenance.findTerminalLogin)
      .mockResolvedValueOnce({ id: 'login', adminUserId: 'actor' })
      .mockResolvedValue(null)
    expect(await createAuthMaintenanceTasks(store, () => now)[1]!.run(context)).toEqual({
      workRemaining: false,
    })
    expect(store.withSessionLock).toHaveBeenCalledWith('actor', expect.any(Function))
    expect(scoped.authMaintenance.pruneTerminalLogin).toHaveBeenCalledWith({
      id: 'login',
      adminUserId: 'actor',
      before: new Date(now.getTime() - 30 * 86_400_000),
    })
    expect(store.authMaintenance.pruneTerminalLogin).not.toHaveBeenCalled()
  })
})
