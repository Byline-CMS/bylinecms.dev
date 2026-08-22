/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `@byline/core/scheduler` — the server-only executable surface of the
 * recurring-task scheduler. The inert types and `defineRecurringTask()` are
 * also re-exported from the package root; the runner and ticker are here so
 * importing browser-safe core code never pulls in Node timers.
 */

export {
  defineRecurringTask,
  MAX_BACKOFF_MS,
  MIN_INTERVAL_MS,
  MIN_LEASE_MS,
} from './define-recurring-task.js'
export { type RunDueTasksOptions, type RunDueTasksSummary, runDueTasks } from './run-due-tasks.js'
export {
  runScheduledPublicationSweep,
  type ScheduledPublicationSweepOptions,
  type ScheduledPublicationSweepResult,
} from './scheduled-publication.js'
export {
  type SchedulerController,
  type SchedulerOptions,
  startBylineScheduler,
} from './ticker.js'
export { validateRecurringTasks } from './validate-tasks.js'
export type {
  ClaimedRecurringTask,
  ISchedulerStore,
  ReconcileTaskInput,
  RecurringTaskContext,
  RecurringTaskDefinition,
  RecurringTaskHealth,
  RecurringTaskResult,
  RecurringTaskStatus,
} from './types.js'
