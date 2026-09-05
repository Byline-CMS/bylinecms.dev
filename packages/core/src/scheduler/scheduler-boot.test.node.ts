/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { Logger as PinoLogger } from 'pino'
import { describe, expect, it } from 'vitest'

import { initBylineCore } from '../core.js'
import { unusedRevisionStore } from '../storage/revision-store.test-helper.js'
import { defineRecurringTask } from './define-recurring-task.js'
import type { IDbAdapter, ServerConfig } from '../@types/index.js'
import type { ISchedulerStore } from './types.js'

// Boot-level coverage for the scheduler wiring inside `initBylineCore()`,
// complementing the pure-function coverage in `validate-scheduler-config.test.node.ts`.
// Collections are kept empty and `db` a minimal stub so init reaches the
// scheduler gate without needing a real database — see `core.test.node.ts`
// for the same pattern.

function serverConfig(db: IDbAdapter): ServerConfig {
  return {
    routes: { admin: '/admin' },
    collections: [],
    db,
    i18n: {
      admin: { defaultLocale: 'en', locales: [] },
      content: { defaultLocale: 'en', locales: [] },
    },
  }
}

const task = defineRecurringTask({
  name: 'analytics.rollup',
  intervalMs: 3_600_000,
  leaseMs: 300_000,
  run: async () => {},
})

describe('initBylineCore scheduler wiring', () => {
  it('rejects recurring tasks registered against an adapter without the scheduler capability', async () => {
    const config = serverConfig({} as unknown as IDbAdapter)
    config.recurringTasks = [task]

    await expect(initBylineCore(config, {} as PinoLogger)).rejects.toThrow(/analytics\.rollup/)
  })

  it('gates scheduled publication on the scheduler capability and contributes its built-in task', async () => {
    const unsupported = serverConfig({} as unknown as IDbAdapter)
    unsupported.scheduledPublication = { enabled: true }
    await expect(initBylineCore(unsupported, {} as PinoLogger)).rejects.toThrow(
      /documents\.publish-scheduled/
    )

    const capable = serverConfig({
      scheduler: {} as ISchedulerStore,
      withTransaction: async (fn: () => Promise<unknown>) => fn(),
      withReadSnapshot: async () => {
        throw new Error('Unexpected editable read')
      },
      commands: {
        collections: { lockCollectionRegistration: async () => {} },
        documents: { publishSchedules: { lockDocuments: async () => {} } },
      },
      revisions: { ...unusedRevisionStore, assertCompatibleSchema: async () => {} },
    } as unknown as IDbAdapter)
    capable.scheduledPublication = { enabled: true }
    capable.recurringTasks = [task]
    const core = await initBylineCore(capable, {} as PinoLogger)

    expect(core.recurringTasks.map((definition) => definition.name)).toEqual([
      'analytics.rollup',
      'documents.publish-scheduled',
    ])
    expect(core.recurringTasks[1]).toMatchObject({
      intervalMs: 60_000,
      leaseMs: 300_000,
    })
  })

  it('populates core.recurringTasks with the registered set when the adapter is capable', async () => {
    const db = {
      scheduler: {} as ISchedulerStore,
      withTransaction: async (fn: () => Promise<unknown>) => fn(),
      withReadSnapshot: async () => {
        throw new Error('Unexpected editable read')
      },
      commands: {
        collections: { lockCollectionRegistration: async () => {} },
        documents: { publishSchedules: { lockDocuments: async () => {} } },
      },
      revisions: { ...unusedRevisionStore, assertCompatibleSchema: async () => {} },
    } as unknown as IDbAdapter
    const config = serverConfig(db)
    config.recurringTasks = [task]

    const core = await initBylineCore(config, {} as PinoLogger)

    expect(core.recurringTasks).toHaveLength(1)
    const [registered] = core.recurringTasks
    expect(registered).toMatchObject({ name: 'analytics.rollup', intervalMs: 3_600_000 })
  })

  it('freezes the validated snapshot so post-init mutation of the caller input cannot alter it', async () => {
    const db = {
      scheduler: {} as ISchedulerStore,
      withTransaction: async (fn: () => Promise<unknown>) => fn(),
      withReadSnapshot: async () => {
        throw new Error('Unexpected editable read')
      },
      commands: {
        collections: { lockCollectionRegistration: async () => {} },
        documents: { publishSchedules: { lockDocuments: async () => {} } },
      },
      revisions: { ...unusedRevisionStore, assertCompatibleSchema: async () => {} },
    } as unknown as IDbAdapter
    const localTask = defineRecurringTask({
      name: 'analytics.local',
      intervalMs: 3_600_000,
      leaseMs: 300_000,
      run: async () => {},
    })
    const originalTasks = [localTask]
    const config = serverConfig(db)
    config.recurringTasks = originalTasks

    const core = await initBylineCore(config, {} as PinoLogger)

    // Mutate the caller's own array and one of its definition objects after
    // init has returned.
    originalTasks.push(
      defineRecurringTask({
        name: 'analytics.extra',
        intervalMs: 3_600_000,
        leaseMs: 300_000,
        run: async () => {},
      })
    )
    localTask.intervalMs = 999

    // The snapshot on `core` is unaffected by either mutation.
    expect(core.recurringTasks).toHaveLength(1)
    const [snapshotTask] = core.recurringTasks
    expect(snapshotTask?.intervalMs).toBe(3_600_000)
    expect(snapshotTask?.name).toBe('analytics.local')

    // The snapshot array and its definition objects are themselves frozen.
    // ES modules are always strict mode, so mutating a frozen array or
    // object throws rather than silently no-op'ing.
    expect(() => {
      ;(core.recurringTasks as unknown as unknown[]).push('nope')
    }).toThrow(TypeError)
    expect(() => {
      ;(snapshotTask as { intervalMs: number }).intervalMs = 1
    }).toThrow(TypeError)
  })
})
