/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { RecurringTaskDefinition } from './types.js'

/** Shortest permitted interval between runs, and shortest permitted lease. */
export const MIN_INTERVAL_MS = 60_000
export const MIN_LEASE_MS = 60_000

/** Maximum bounded retry delay after repeated failures. */
export const MAX_BACKOFF_MS = 15 * 60_000

/**
 * Identity helper that gives a task definition its type without starting
 * anything. Registration is not execution: timers begin only when the host
 * calls `startBylineScheduler()`.
 */
export function defineRecurringTask(definition: RecurringTaskDefinition): RecurringTaskDefinition {
  return definition
}
