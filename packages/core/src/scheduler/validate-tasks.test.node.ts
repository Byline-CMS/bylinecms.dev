/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { defineRecurringTask } from './define-recurring-task.js'
import { validateRecurringTasks } from './validate-tasks.js'

const ok = defineRecurringTask({
  name: 'analytics.rollup',
  intervalMs: 3_600_000,
  leaseMs: 300_000,
  run: async () => {},
})

describe('validateRecurringTasks', () => {
  it('accepts a valid set', () => {
    expect(() => validateRecurringTasks([ok])).not.toThrow()
  })

  it('accepts an empty set', () => {
    expect(() => validateRecurringTasks([])).not.toThrow()
  })

  it('rejects duplicate names', () => {
    expect(() => validateRecurringTasks([ok, { ...ok }])).toThrow(/duplicate/i)
  })

  it('rejects a blank name', () => {
    expect(() => validateRecurringTasks([{ ...ok, name: '   ' }])).toThrow(/name/i)
  })

  it('rejects an interval below the 60s minimum', () => {
    expect(() => validateRecurringTasks([{ ...ok, intervalMs: 59_999 }])).toThrow(/interval/i)
  })

  it('rejects a lease below the 60s minimum', () => {
    expect(() => validateRecurringTasks([{ ...ok, leaseMs: 59_999 }])).toThrow(/lease/i)
  })

  it('rejects non-finite durations', () => {
    expect(() => validateRecurringTasks([{ ...ok, intervalMs: Number.NaN }])).toThrow(/interval/i)
    expect(() => validateRecurringTasks([{ ...ok, leaseMs: Number.POSITIVE_INFINITY }])).toThrow(
      /lease/i
    )
  })

  it('rejects a missing run function', () => {
    expect(() => validateRecurringTasks([{ ...ok, run: undefined as never }])).toThrow(/run/i)
  })
})
