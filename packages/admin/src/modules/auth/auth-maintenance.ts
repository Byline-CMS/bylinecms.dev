/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { RecurringTaskDefinition } from '@byline/core'

import type { AdminStore } from '../../store.js'

const DAY = 86_400_000

/** Register for native sessions even on password-only sites; configuration never runs cleanup. */
export function createAuthMaintenanceTasks(
  store: AdminStore,
  now: () => Date = () => new Date()
): RecurringTaskDefinition[] {
  const task = (
    name: string,
    retention: number,
    batch: (cutoff: Date) => Promise<boolean>
  ): RecurringTaskDefinition => ({
    name: `auth.maintenance.${name}`,
    intervalMs: 60_000,
    leaseMs: 60_000,
    async run(context) {
      const started = performance.now()
      const cutoff = new Date(now().getTime() - retention)
      for (let n = 0; n < 32 && performance.now() - started < 30_000; n++) {
        context.signal.throwIfAborted()
        await context.heartbeat()
        context.signal.throwIfAborted()
        if (!(await batch(cutoff))) return { workRemaining: false }
      }
      return { workRemaining: true }
    },
  })
  return [
    task(
      'attempts',
      300_000,
      async (cutoff) => (await store.authMaintenance.purgeAttempts(cutoff)) === 100
    ),
    task('logins', 30 * DAY, async (cutoff) => {
      const candidate = await store.authMaintenance.findTerminalLogin(cutoff)
      if (!candidate) return false
      await store.withSessionLock(candidate.adminUserId, async (scoped) => {
        await scoped.authMaintenance.pruneTerminalLogin({ ...candidate, before: cutoff })
      })
      // A candidate is not a cursor. Re-scan after each bounded transaction so
      // a login with many refresh predecessors drains without a long-held lock.
      return true
    }),
    task(
      'legacy-refresh',
      30 * DAY,
      async (cutoff) => (await store.authMaintenance.purgeLegacyRefreshTokens(cutoff)) === 100
    ),
  ]
}
