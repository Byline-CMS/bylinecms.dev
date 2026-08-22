/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { defineRecurringTask } from './define-recurring-task.js'
import { validateSchedulerConfig } from './validate-scheduler-config.js'
import type { ISchedulerStore } from './types.js'

const task = defineRecurringTask({
  name: 'analytics.rollup',
  intervalMs: 3_600_000,
  leaseMs: 300_000,
  run: async () => {},
})

const store = {} as ISchedulerStore

describe('validateSchedulerConfig', () => {
  it('passes when tasks are registered against a scheduler-capable adapter', () => {
    expect(() =>
      validateSchedulerConfig({ tasks: [task], adapter: { scheduler: store } })
    ).not.toThrow()
  })

  it('passes when no tasks are registered and the adapter lacks the capability', () => {
    expect(() => validateSchedulerConfig({ tasks: [], adapter: {} })).not.toThrow()
    expect(() => validateSchedulerConfig({ adapter: {} })).not.toThrow()
  })

  it('fails when tasks are registered against an adapter without the capability', () => {
    expect(() => validateSchedulerConfig({ tasks: [task], adapter: {} })).toThrow(/scheduler/i)
  })

  it('names the offending tasks in the failure message', () => {
    expect(() => validateSchedulerConfig({ tasks: [task], adapter: {} })).toThrow(
      /analytics\.rollup/
    )
  })

  it('applies task validation as part of config validation', () => {
    expect(() =>
      validateSchedulerConfig({
        tasks: [{ ...task, intervalMs: 1_000 }],
        adapter: { scheduler: store },
      })
    ).toThrow(/interval/i)
  })
})
