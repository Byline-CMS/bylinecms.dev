/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AnalyticsDashboardPeriod } from '@byline/admin/analytics'

export function buildAnalyticsDashboardRange(
  period: AnalyticsDashboardPeriod,
  now = new Date()
): { from: string; to: string } {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
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
