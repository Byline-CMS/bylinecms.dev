/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { MIN_INTERVAL_MS, MIN_LEASE_MS } from './define-recurring-task.js'
import type { RecurringTaskDefinition } from './types.js'

function assertDuration(value: number, label: string, minimum: number, taskName: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(
      `recurring task '${taskName}': ${label} must be a finite number of milliseconds`
    )
  }
  if (value < minimum) {
    throw new Error(
      `recurring task '${taskName}': ${label} must be at least ${minimum}ms (received ${value})`
    )
  }
}

/**
 * Boot-time validation of the registered task set. Throws on the first problem
 * so a misconfigured deployment fails loudly at startup rather than silently
 * never running work.
 */
export function validateRecurringTasks(definitions: readonly RecurringTaskDefinition[]): void {
  const seen = new Set<string>()

  for (const definition of definitions) {
    const name = definition?.name
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error('recurring task: name must be a non-empty string')
    }
    if (seen.has(name)) {
      throw new Error(`recurring task '${name}': duplicate task name`)
    }
    seen.add(name)

    assertDuration(definition.intervalMs, 'intervalMs', MIN_INTERVAL_MS, name)
    assertDuration(definition.leaseMs, 'leaseMs', MIN_LEASE_MS, name)

    if (typeof definition.run !== 'function') {
      throw new Error(`recurring task '${name}': run must be a function`)
    }
  }
}
