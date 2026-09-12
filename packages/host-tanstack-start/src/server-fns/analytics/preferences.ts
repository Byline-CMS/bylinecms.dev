/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Read and persist the signed-in admin user's sticky analytics
 * dashboard period.
 *
 * The dashboard keeps its period in the URL (`?period=90`), so a shared
 * link still opens exactly as sent; this preference only supplies the
 * period when the URL carries none. Same precedence the collection list
 * uses for page size and sort — explicit params win, the stored
 * preference fills in, the built-in default is last.
 *
 * The scope is a singleton (`analytics.dashboard`), unlike the
 * collection list's per-path scopes, so there is nothing to validate
 * the way `set-list-view-preference` validates a collection path.
 *
 * Self-service: the target user is always the authenticated actor.
 */

import { createServerFn } from '@tanstack/react-start'

import { getPreferenceCommand, setPreferenceCommand } from '@byline/admin/admin-preferences'
import type { AnalyticsDashboardPeriod } from '@byline/admin/analytics'
import { isAnalyticsDashboardPeriod } from '@byline/analytics/config'
import { getAdminRequestContext } from '@byline/client/server'
import { getLogger } from '@byline/core'

import { bylineCore } from '../../integrations/byline-core.js'
import { adminSessionMiddleware } from '../../integrations/session-middleware.js'

const ANALYTICS_DASHBOARD_SCOPE = 'analytics.dashboard'

export interface SetAnalyticsDashboardPreferenceInput {
  period: AnalyticsDashboardPeriod
}

/**
 * The stored period, or `null` when the user has never chosen one (or
 * this host has no admin store).
 *
 * Never throws: a preference read must not be able to take the
 * dashboard down. A headless context, an unauthenticated preview, or a
 * database hiccup logs and yields `null`, and the caller falls back to
 * the built-in default — the same posture the collection list's
 * preference read takes.
 */
export const getAnalyticsDashboardPreference = createServerFn({ method: 'GET' })
  .middleware([adminSessionMiddleware])
  .handler(async (): Promise<{ period: AnalyticsDashboardPeriod | null }> => {
    const adminStore = bylineCore().adminStore
    if (adminStore == null) return { period: null }

    try {
      const context = await getAdminRequestContext()
      const result = await getPreferenceCommand(
        context,
        { scope: ANALYTICS_DASHBOARD_SCOPE },
        { store: adminStore }
      )
      const period = (result.value as { period?: unknown } | null)?.period
      // Re-validated on the way out, not just on the way in: a row
      // written before a period was retired from the dashboard must
      // degrade to the default rather than reach `buildAnalyticsDashboardRange`.
      return { period: isAnalyticsDashboardPeriod(period) ? period : null }
    } catch (err) {
      getLogger().warn({ err }, 'analytics dashboard preference read failed — using default')
      return { period: null }
    }
  })

/**
 * Persist the chosen period. Fire-and-forget from the dashboard: the
 * navigation has already happened, so a failed save must never toast,
 * block, or roll anything back.
 */
export const setAnalyticsDashboardPreference = createServerFn({ method: 'POST' })
  .middleware([adminSessionMiddleware])
  .validator((input: SetAnalyticsDashboardPreferenceInput) => input)
  .handler(async ({ data }) => {
    const adminStore = bylineCore().adminStore
    if (adminStore == null) {
      // Headless hosts without an admin store have no preference storage —
      // the save is a silent no-op, mirroring set-locale's posture.
      return { ok: true as const }
    }
    const context = await getAdminRequestContext()
    await setPreferenceCommand(
      context,
      { scope: ANALYTICS_DASHBOARD_SCOPE, value: { period: data.period } },
      { store: adminStore }
    )
    return { ok: true as const }
  })
