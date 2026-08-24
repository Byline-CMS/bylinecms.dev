/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { assertAdminActor, requireAdminActor } from '@byline/admin'
import { ANALYTICS_ABILITIES } from '@byline/admin/analytics'
import type {
  AnalyticsCountryTotal,
  AnalyticsDateRange,
  AnalyticsEventKind,
  AnalyticsPathTotal,
  AnalyticsRankedTotals,
  AnalyticsReferrerTotal,
  AnalyticsReportCoverage,
  AnalyticsSummary,
} from '@byline/analytics'
import { getAdminRequestContext } from '@byline/client/server'

export interface AnalyticsTopInput extends AnalyticsDateRange {
  kind: AnalyticsEventKind
  limit?: number
}

export interface AnalyticsRuntimeState {
  enabled: boolean
}

export const getAnalyticsRuntime = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AnalyticsRuntimeState> => {
    const context = await getAdminRequestContext()
    requireAdminActor(context, 'reading analytics runtime state')
    const { isAnalyticsRegistered } = await import('@byline/analytics')
    return { enabled: isAnalyticsRegistered() }
  }
)

export const getAnalyticsSummary = createServerFn({ method: 'GET' })
  .validator((input: AnalyticsDateRange) => input)
  .handler(async ({ data }): Promise<AnalyticsSummary> => {
    await assertAnalyticsRead()
    const { getAnalytics } = await import('@byline/analytics')
    return getAnalytics().getSummary(data)
  })

export const getAnalyticsReportCoverage = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AnalyticsReportCoverage> => {
    await assertAnalyticsRead()
    const { getAnalytics } = await import('@byline/analytics')
    return getAnalytics().getReportCoverage()
  }
)

export const getAnalyticsTop = createServerFn({ method: 'GET' })
  .validator((input: AnalyticsTopInput) => input)
  .handler(async ({ data }): Promise<AnalyticsRankedTotals<AnalyticsPathTotal>> => {
    await assertAnalyticsRead()
    const { getAnalytics } = await import('@byline/analytics')
    return getAnalytics().getTopPaths(data)
  })

export const getAnalyticsReferrers = createServerFn({ method: 'GET' })
  .validator((input: AnalyticsDateRange & { limit?: number }) => input)
  .handler(async ({ data }): Promise<AnalyticsRankedTotals<AnalyticsReferrerTotal>> => {
    await assertAnalyticsRead()
    const { getAnalytics } = await import('@byline/analytics')
    return getAnalytics().getReferrers(data)
  })

export const getAnalyticsCountries = createServerFn({ method: 'GET' })
  .validator((input: AnalyticsDateRange) => input)
  .handler(async ({ data }): Promise<AnalyticsCountryTotal[]> => {
    await assertAnalyticsRead()
    const { getAnalytics } = await import('@byline/analytics')
    return getAnalytics().getCountries(data)
  })

async function assertAnalyticsRead(): Promise<void> {
  const context = await getAdminRequestContext()
  assertAdminActor(context, ANALYTICS_ABILITIES.read)
}
