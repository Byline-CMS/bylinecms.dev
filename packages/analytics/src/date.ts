/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AnalyticsDay } from './types.js'

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function analyticsDay(date: Date): AnalyticsDay {
  return date.toISOString().slice(0, 10)
}

export function assertAnalyticsDay(value: string, label = 'day'): AnalyticsDay {
  if (!DAY_PATTERN.test(value)) throw new Error(`${label} must use YYYY-MM-DD`)
  const date = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(date.valueOf()) || analyticsDay(date) !== value) {
    throw new Error(`${label} must be a real UTC calendar day`)
  }
  return value
}

export function addAnalyticsDays(day: AnalyticsDay, amount: number): AnalyticsDay {
  const date = new Date(`${assertAnalyticsDay(day)}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return analyticsDay(date)
}

export function startOfAnalyticsDay(day: AnalyticsDay): Date {
  return new Date(`${assertAnalyticsDay(day)}T00:00:00.000Z`)
}

export function compareAnalyticsDays(left: AnalyticsDay, right: AnalyticsDay): number {
  return left < right ? -1 : left > right ? 1 : 0
}
