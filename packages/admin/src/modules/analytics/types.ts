/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  AnalyticsCountryTotal,
  AnalyticsPathTotal,
  AnalyticsRankedTotals,
  AnalyticsReferrerTotal,
  AnalyticsSummary,
} from '@byline/analytics'
import type { AnalyticsDashboardPeriod as PortableAnalyticsDashboardPeriod } from '@byline/analytics/config'

export type AnalyticsDashboardPeriod = PortableAnalyticsDashboardPeriod

export interface AnalyticsDashboardData {
  summary: AnalyticsSummary
  pages: AnalyticsRankedTotals<AnalyticsPathTotal>
  downloads: AnalyticsRankedTotals<AnalyticsPathTotal>
  referrers: AnalyticsRankedTotals<AnalyticsReferrerTotal>
  /** Countries are unbounded by a top-N limit, so there is nothing to truncate. */
  countries: AnalyticsCountryTotal[]
}
