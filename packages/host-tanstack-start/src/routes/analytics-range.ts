/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AnalyticsDashboardPeriod } from '@byline/admin/analytics'

const UTC_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

export function buildAnalyticsDashboardRange(
  period: AnalyticsDashboardPeriod,
  now = new Date(),
  earliestReportDay: string | null = null
): { from: string; to: string } {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  if (period === 'ytd') {
    return {
      from: formatUtcDay(new Date(Date.UTC(to.getUTCFullYear(), 0, 1))),
      to: formatUtcDay(to),
    }
  }

  if (period === 'all') {
    const toDay = formatUtcDay(to)
    const earliest = earliestReportDay == null ? toDay : assertUtcDay(earliestReportDay)
    return {
      from: earliest <= toDay ? earliest : toDay,
      to: toDay,
    }
  }

  const from = new Date(to)
  from.setUTCDate(from.getUTCDate() - (period - 1))
  return { from: formatUtcDay(from), to: formatUtcDay(to) }
}

function formatUtcDay(value: Date): string {
  const year = value.getUTCFullYear().toString().padStart(4, '0')
  const month = (value.getUTCMonth() + 1).toString().padStart(2, '0')
  const day = value.getUTCDate().toString().padStart(2, '0')
  return `${year}-${month}-${day}`
}

function assertUtcDay(value: string): string {
  if (!UTC_DAY_PATTERN.test(value)) throw new Error('analytics report day must use YYYY-MM-DD')
  const date = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(date.valueOf()) || formatUtcDay(date) !== value) {
    throw new Error('analytics report day must be a real UTC calendar day')
  }
  return value
}
