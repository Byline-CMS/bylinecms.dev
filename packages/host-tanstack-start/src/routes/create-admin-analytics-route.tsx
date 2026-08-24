/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, notFound } from '@tanstack/react-router'

import type { AnalyticsDashboardData, AnalyticsDashboardPeriod } from '@byline/admin/analytics'
import { AnalyticsDashboard } from '@byline/admin/analytics/components/dashboard'
import { isAnalyticsDashboardPeriod } from '@byline/analytics/config'
import { useTranslation } from '@byline/i18n/react'
import { z } from 'zod'

import { BreadcrumbsClient } from '../admin-shell/chrome/breadcrumbs/breadcrumbs-client.js'
import { useNavigate } from '../admin-shell/chrome/loose-router.js'
import {
  getAnalyticsCountries,
  getAnalyticsReferrers,
  getAnalyticsRuntime,
  getAnalyticsSummary,
  getAnalyticsTop,
} from '../server-fns/analytics/index.js'
import { getAdminRoutePath } from './admin-path.js'
import { buildAnalyticsDashboardRange } from './analytics-range.js'

const periodSchema = z.preprocess(
  (value) => (value == null ? undefined : Number(value)),
  z
    .custom<AnalyticsDashboardPeriod>(
      (value) => typeof value === 'number' && isAnalyticsDashboardPeriod(value)
    )
    .optional()
)

const searchSchema = z.object({
  period: periodSchema.catch(undefined),
})

interface AnalyticsSearch {
  period?: AnalyticsDashboardPeriod
}

export function createAdminAnalyticsRoute(path: string) {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic path bypasses route-tree typing
  const Route: any = createFileRoute(path as never)({
    validateSearch: searchSchema,
    loaderDeps: ({ search }: { search: AnalyticsSearch }) => ({
      period: search.period ?? 30,
    }),
    loader: async ({ deps }: { deps: { period: AnalyticsDashboardPeriod } }) => {
      const runtime = await getAnalyticsRuntime()
      if (!runtime.enabled) throw notFound()

      const range = buildAnalyticsDashboardRange(deps.period)
      const [summary, pages, downloads, referrers, countries] = await Promise.all([
        getAnalyticsSummary({ data: range }),
        getAnalyticsTop({ data: { ...range, kind: 'page', limit: 20 } }),
        getAnalyticsTop({ data: { ...range, kind: 'download', limit: 20 } }),
        getAnalyticsReferrers({ data: { ...range, limit: 20 } }),
        getAnalyticsCountries({ data: range }),
      ])

      return {
        data: { summary, pages, downloads, referrers, countries } satisfies AnalyticsDashboardData,
        period: deps.period,
      }
    },
    component: function AdminAnalyticsComponent() {
      const { data, period } = Route.useLoaderData() as {
        data: AnalyticsDashboardData
        period: AnalyticsDashboardPeriod
      }
      const navigate = useNavigate()
      const { t } = useTranslation('byline-admin')

      return (
        <>
          <BreadcrumbsClient
            breadcrumbs={[
              { label: t('chrome.menu.dashboard'), href: getAdminRoutePath() },
              { label: t('analytics.title'), href: getAdminRoutePath('analytics') },
            ]}
          />
          <AnalyticsDashboard
            data={data}
            period={period}
            onPeriodChange={(nextPeriod) => {
              navigate({
                to: getAdminRoutePath('analytics'),
                search: { period: nextPeriod },
              })
            }}
          />
        </>
      )
    },
  })

  return Route
}
