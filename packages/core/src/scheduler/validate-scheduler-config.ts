/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { validateRecurringTasks } from './validate-tasks.js'
import type { ISchedulerStore, RecurringTaskDefinition } from './types.js'

/**
 * Boot-time gate. Recurring tasks registered against an adapter that does not
 * implement the optional scheduler capability would silently never run, so this
 * fails loudly at `initBylineCore()` instead.
 */
export function validateSchedulerConfig(params: {
  tasks?: readonly RecurringTaskDefinition[]
  adapter: { scheduler?: ISchedulerStore }
}): void {
  const tasks = params.tasks ?? []
  if (tasks.length === 0) return

  validateRecurringTasks(tasks)

  if (params.adapter.scheduler == null) {
    const names = tasks.map((t) => t.name).join(', ')
    throw new Error(
      `recurring tasks are registered (${names}) but the configured database adapter does not ` +
        'implement the scheduler capability. Use a canonical adapter (@byline/db-postgres or ' +
        '@byline/db-mysql), or remove the tasks.'
    )
  }
}
