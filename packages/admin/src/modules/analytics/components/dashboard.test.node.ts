/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { AnalyticsSummaryDay } from '@byline/analytics'
import { describe, expect, it } from 'vitest'

import { formatShare, partialCoverageFrom, shareWidth } from './dashboard.js'
import {
  bucketAnalyticsTimeseries,
  buildAnalyticsColumns,
  resolveAnalyticsChartGranularity,
} from './timeseries.js'

function day(date: string, views: number, visitors: number): AnalyticsSummaryDay {
  return { day: date, views, visitors, downloads: 0 }
}

describe('buildAnalyticsColumns', () => {
  it('scales every column against the tallest day in the window', () => {
    const columns = buildAnalyticsColumns([
      day('2026-08-20', 0, 0),
      day('2026-08-21', 5, 3),
      day('2026-08-22', 10, 4),
    ])

    expect(columns).toHaveLength(3)
    expect(columns[0]?.height).toBe(0)
    expect(columns[1]?.height).toBe(90)
    expect(columns[2]?.height).toBe(180)
    // The tallest column reaches the top of the plot, and every column sits on
    // the baseline: y + height is the full viewBox height.
    for (const column of columns) {
      expect(column.y + column.height).toBeCloseTo(180)
    }
  })

  it('keeps the unique-visitor mark inset within its own day', () => {
    const [column] = buildAnalyticsColumns([day('2026-08-20', 10, 4)])
    if (column == null) throw new Error('expected one column')

    // Visitors can never exceed that day's views, so the inset mark is always
    // shorter and narrower than the column it sits inside.
    expect(column.insetHeight).toBeLessThan(column.height)
    expect(column.insetWidth).toBeLessThan(column.width)
    expect(column.insetX).toBeGreaterThan(column.x)
    expect(column.insetX + column.insetWidth).toBeLessThan(column.x + column.width)
  })

  it('survives an all-zero window without dividing by zero', () => {
    const columns = buildAnalyticsColumns([day('2026-08-20', 0, 0), day('2026-08-21', 0, 0)])
    expect(columns.map((column) => column.height)).toEqual([0, 0])
    expect(columns.every((column) => Number.isFinite(column.x))).toBe(true)
  })

  it('returns nothing for an empty window', () => {
    expect(buildAnalyticsColumns([])).toEqual([])
  })

  it('spans the full plot width and never overlaps neighbouring hit targets', () => {
    const columns = buildAnalyticsColumns([
      day('2026-08-20', 1, 1),
      day('2026-08-21', 2, 1),
      day('2026-08-22', 3, 2),
    ])
    expect(columns[0]?.hitX).toBe(0)
    const last = columns[columns.length - 1]
    expect((last?.hitX ?? 0) + (last?.hitWidth ?? 0)).toBeCloseTo(900)
    for (let index = 1; index < columns.length; index += 1) {
      const previous = columns[index - 1]
      expect(columns[index]?.hitX).toBeCloseTo((previous?.hitX ?? 0) + (previous?.hitWidth ?? 0))
    }
  })
})

describe('analytics chart buckets', () => {
  it('selects granularity explicitly from the reporting period and range size', () => {
    expect(resolveAnalyticsChartGranularity(90, 90)).toBe('day')
    expect(resolveAnalyticsChartGranularity('ytd', 90)).toBe('seven-day')
    expect(resolveAnalyticsChartGranularity('all', 90)).toBe('day')
    expect(resolveAnalyticsChartGranularity('all', 91)).toBe('seven-day')
    expect(resolveAnalyticsChartGranularity('all', 733)).toBe('month')
  })

  it('keeps day boundaries and width in daily buckets', () => {
    expect(bucketAnalyticsTimeseries([day('2026-01-01', 2, 1)], 'day')).toEqual([
      {
        from: '2026-01-01',
        to: '2026-01-01',
        granularity: 'day',
        dayCount: 1,
        views: 2,
        visitors: 1,
        downloads: 0,
      },
    ])
  })

  it('sums daily rows into explicit seven-day buckets', () => {
    const days = Array.from({ length: 8 }, (_, index) =>
      day(`2026-01-${String(index + 1).padStart(2, '0')}`, 2, 1)
    )
    expect(bucketAnalyticsTimeseries(days, 'seven-day')).toEqual([
      {
        from: '2026-01-01',
        to: '2026-01-07',
        granularity: 'seven-day',
        dayCount: 7,
        views: 14,
        visitors: 7,
        downloads: 0,
      },
      {
        from: '2026-01-08',
        to: '2026-01-08',
        granularity: 'seven-day',
        dayCount: 1,
        views: 2,
        visitors: 1,
        downloads: 0,
      },
    ])
  })

  it('aligns month buckets to UTC calendar boundaries', () => {
    expect(
      bucketAnalyticsTimeseries(
        [day('2026-01-31', 2, 1), day('2026-02-01', 3, 2), day('2026-02-02', 4, 2)],
        'month'
      )
    ).toEqual([
      {
        from: '2026-01-31',
        to: '2026-01-31',
        granularity: 'month',
        dayCount: 1,
        views: 2,
        visitors: 1,
        downloads: 0,
      },
      {
        from: '2026-02-01',
        to: '2026-02-02',
        granularity: 'month',
        dayCount: 2,
        views: 7,
        visitors: 4,
        downloads: 0,
      },
    ])
  })
})

describe('shareWidth', () => {
  it('scales a row against the largest row in its list', () => {
    expect(shareWidth(50, 100)).toBe(50)
    expect(shareWidth(100, 100)).toBe(100)
  })

  it('keeps the smallest row visible rather than collapsing it', () => {
    expect(shareWidth(1, 10_000)).toBe(3)
  })

  it('returns no bar for absent or impossible values', () => {
    expect(shareWidth(0, 100)).toBe(0)
    expect(shareWidth(5, 0)).toBe(0)
    expect(shareWidth(Number.NaN, 100)).toBe(0)
  })
})

describe('formatShare', () => {
  it('renders a locale-aware percentage of the whole', () => {
    expect(formatShare(96, 1_200, 'en-US')).toBe('8%')
    expect(formatShare(1, 3, 'en-US')).toBe('33.3%')
  })

  it('reports zero rather than NaN when there is nothing to divide', () => {
    expect(formatShare(0, 0, 'en-US')).toBe('0%')
  })
})

describe('partialCoverageFrom', () => {
  it('returns a retained boundary only when it truncates the report', () => {
    expect(partialCoverageFrom('2025-01-01', '2026-05-26')).toBe('2026-05-26')
    expect(partialCoverageFrom('2026-05-27', '2026-05-26')).toBeUndefined()
    expect(partialCoverageFrom('2026-05-26', '2026-05-26')).toBeUndefined()
    expect(partialCoverageFrom('2025-01-01', null)).toBeUndefined()
  })
})
