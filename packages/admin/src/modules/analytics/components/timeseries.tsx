'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * The analytics timeseries — one column per explicit UTC reporting bucket.
 *
 * A column rather than a continuous line is a claim about the data, not a
 * style: the rows behind this chart are sums of daily aggregates and visitor
 * hashes rotate at UTC midnight, so nothing is measured between two points.
 * The dashboard selects the granularity and passes it into this renderer;
 * the chart never guesses from the number of rows.
 */
import type React from 'react'
import { useMemo, useRef, useState } from 'react'

import type { AnalyticsSummaryDay } from '@byline/analytics'
import type { AnalyticsDashboardPeriod } from '@byline/analytics/config'
import { useTranslation } from '@byline/i18n/react'
import cx from 'clsx'

import styles from './timeseries.module.css'

/** Drawn in a fixed user-space box and stretched to the container width. */
const VIEWBOX_WIDTH = 900
const VIEWBOX_HEIGHT = 180
const COLUMN_GAP_RATIO = 0.38
const MAX_COLUMN_WIDTH = 26

export type AnalyticsChartGranularity = 'day' | 'seven-day' | 'month'

export interface AnalyticsChartBucket {
  from: string
  to: string
  granularity: AnalyticsChartGranularity
  /** Actual number of daily rows, including partial first or last buckets. */
  dayCount: number
  views: number
  /** Sum of the bucket's daily-unique visitor values. */
  visitors: number
  downloads: number
}

export interface AnalyticsColumn {
  index: number
  /** Full-height mark: that bucket's page views. */
  x: number
  width: number
  y: number
  height: number
  /** Inset mark: summed daily uniques, always no greater than views. */
  insetX: number
  insetWidth: number
  insetY: number
  insetHeight: number
  /** Full-height transparent target, so narrow columns stay easy to hit. */
  hitX: number
  hitWidth: number
}

/** Resolve chart density outside the renderer so the chosen width is explicit. */
export function resolveAnalyticsChartGranularity(
  period: AnalyticsDashboardPeriod,
  dayCount: number
): AnalyticsChartGranularity {
  if (typeof period === 'number' || (period === 'all' && dayCount <= 90)) return 'day'
  if (period === 'ytd' || dayCount <= 732) return 'seven-day'
  return 'month'
}

/** Combine complete daily query rows using the caller-selected granularity. */
export function bucketAnalyticsTimeseries(
  days: readonly AnalyticsSummaryDay[],
  granularity: AnalyticsChartGranularity
): readonly AnalyticsChartBucket[] {
  if (granularity === 'day') {
    return days.map((day) => ({
      from: day.day,
      to: day.day,
      granularity,
      dayCount: 1,
      views: day.views,
      visitors: day.visitors,
      downloads: day.downloads,
    }))
  }
  if (granularity === 'seven-day') return bucketBySevenDays(days)
  return bucketByUtcMonth(days)
}

/** Project reporting buckets into column geometry. */
export function buildAnalyticsColumns(
  buckets: readonly Pick<AnalyticsChartBucket, 'views' | 'visitors'>[]
): readonly AnalyticsColumn[] {
  if (buckets.length === 0) return []
  const ceiling = Math.max(1, ...buckets.map((bucket) => bucket.views))
  const step = VIEWBOX_WIDTH / buckets.length
  const width = Math.max(2, Math.min(step * (1 - COLUMN_GAP_RATIO), MAX_COLUMN_WIDTH))

  return buckets.map((bucket, index) => {
    const centre = index * step + step / 2
    const height = (bucket.views / ceiling) * VIEWBOX_HEIGHT
    const insetHeight = (bucket.visitors / ceiling) * VIEWBOX_HEIGHT
    const insetWidth = Math.max(1, width / 2)
    return {
      index,
      x: centre - width / 2,
      width,
      y: VIEWBOX_HEIGHT - height,
      height,
      insetX: centre - insetWidth / 2,
      insetWidth,
      insetY: VIEWBOX_HEIGHT - insetHeight,
      insetHeight,
      hitX: index * step,
      hitWidth: step,
    }
  })
}

export interface AnalyticsTimeseriesProps {
  days: readonly AnalyticsSummaryDay[]
  granularity: AnalyticsChartGranularity
  locale: string
}

export function AnalyticsTimeseries({
  days,
  granularity,
  locale,
}: AnalyticsTimeseriesProps): React.JSX.Element {
  const { t } = useTranslation('byline-admin')
  const [hovered, setHovered] = useState<number | null>(null)
  const plot = useRef<SVGSVGElement | null>(null)

  const buckets = useMemo(() => bucketAnalyticsTimeseries(days, granularity), [days, granularity])
  const columns = useMemo(() => buildAnalyticsColumns(buckets), [buckets])
  const numbers = useMemo(() => new Intl.NumberFormat(locale), [locale])
  // Stored days are UTC calendar days. Formatting in the viewer's zone would
  // shift the labels by up to one day.
  const dayLabel = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    [locale]
  )

  const formatDay = (day: string) => dayLabel.format(new Date(`${day}T00:00:00.000Z`))
  const formatBucket = (bucket: AnalyticsChartBucket) =>
    bucket.dayCount === 1
      ? formatDay(bucket.from)
      : `${formatDay(bucket.from)} – ${formatDay(bucket.to)}`
  const visitorLabel = (bucket: AnalyticsChartBucket) =>
    bucket.granularity === 'day'
      ? t('analytics.stats.dailyUniques')
      : t('analytics.stats.summedDailyUniques')
  const active = hovered == null ? undefined : buckets[hovered]
  const readBucket = (bucket: AnalyticsChartBucket) =>
    [
      formatBucket(bucket),
      `${t('analytics.stats.views')} ${numbers.format(bucket.views)}`,
      `${visitorLabel(bucket)} ${numbers.format(bucket.visitors)}`,
      `${t('analytics.stats.downloads')} ${numbers.format(bucket.downloads)}`,
    ].join(', ')

  // One handler on the plot rather than one per column keeps every reporting
  // range to a single pointer listener and one keyboard tab stop.
  const trackPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (buckets.length === 0 || plot.current == null) return
    const bounds = plot.current.getBoundingClientRect()
    if (bounds.width === 0) return
    const ratio = (event.clientX - bounds.left) / bounds.width
    setHovered(Math.min(buckets.length - 1, Math.max(0, Math.floor(ratio * buckets.length))))
  }

  const trackKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (buckets.length === 0) return
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0 && event.key !== 'Home' && event.key !== 'End' && event.key !== 'Escape') return
    event.preventDefault()
    if (event.key === 'Escape') return setHovered(null)
    if (event.key === 'Home') return setHovered(0)
    if (event.key === 'End') return setHovered(buckets.length - 1)
    setHovered((current) => {
      const next = (current ?? (step > 0 ? -1 : buckets.length)) + step
      return Math.min(buckets.length - 1, Math.max(0, next))
    })
  }

  return (
    <div
      className={cx('byline-analytics-timeseries', styles.root)}
      role="slider"
      tabIndex={0}
      aria-label={t('analytics.chart.views')}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, buckets.length - 1)}
      aria-valuenow={hovered ?? 0}
      aria-valuetext={active == null ? t('analytics.chart.hint') : readBucket(active)}
      onPointerMove={trackPointer}
      onPointerLeave={() => setHovered(null)}
      onKeyDown={trackKey}
      onBlur={() => setHovered(null)}
    >
      <svg
        ref={plot}
        className={cx('byline-analytics-chart', styles.chart)}
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <title>{t('analytics.chart.views')}</title>
        {[0.5, 1].map((fraction) => (
          <line
            key={fraction}
            className={styles.gridline}
            x1={0}
            x2={VIEWBOX_WIDTH}
            y1={VIEWBOX_HEIGHT - VIEWBOX_HEIGHT * fraction}
            y2={VIEWBOX_HEIGHT - VIEWBOX_HEIGHT * fraction}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {columns.map((column) => (
          <g
            key={buckets[column.index]?.from}
            className={cx(styles.column, hovered === column.index && styles.columnActive)}
          >
            <rect
              className={styles.views}
              x={column.x}
              width={column.width}
              y={column.y}
              height={column.height}
            />
            <rect
              className={styles.visitors}
              x={column.insetX}
              width={column.insetWidth}
              y={column.insetY}
              height={column.insetHeight}
            />
          </g>
        ))}
      </svg>

      {/* HTML axis labels remain undistorted while the SVG stretches. */}
      <div className={cx('byline-analytics-axis', styles.axis)} aria-hidden="true">
        <span>{buckets.length > 0 && buckets[0] != null ? formatDay(buckets[0].from) : ''}</span>
        <span>
          {buckets.length > 0 && buckets[buckets.length - 1] != null
            ? formatDay(buckets[buckets.length - 1]?.to ?? '')
            : ''}
        </span>
      </div>

      <p className={cx('byline-analytics-readout', styles.readout)} aria-live="polite">
        {active == null ? (
          t('analytics.chart.hint')
        ) : (
          <>
            <strong>{formatBucket(active)}</strong>
            <span className={styles.swatchViews} />
            {t('analytics.stats.views')} {numbers.format(active.views)}
            <span className={styles.swatchVisitors} />
            {visitorLabel(active)} {numbers.format(active.visitors)}
            <span className={styles.swatchDownloads} />
            {t('analytics.stats.downloads')} {numbers.format(active.downloads)}
          </>
        )}
      </p>
    </div>
  )
}

function bucketBySevenDays(days: readonly AnalyticsSummaryDay[]): AnalyticsChartBucket[] {
  const buckets: AnalyticsChartBucket[] = []
  for (let index = 0; index < days.length; index += 7) {
    const rows = days.slice(index, index + 7)
    const first = rows[0]
    const last = rows[rows.length - 1]
    if (first != null && last != null) {
      buckets.push(combineRows(first.day, last.day, 'seven-day', rows))
    }
  }
  return buckets
}

function bucketByUtcMonth(days: readonly AnalyticsSummaryDay[]): AnalyticsChartBucket[] {
  const buckets: AnalyticsChartBucket[] = []
  let rows: AnalyticsSummaryDay[] = []
  let month: string | undefined

  const flush = () => {
    const first = rows[0]
    const last = rows[rows.length - 1]
    if (first != null && last != null) {
      buckets.push(combineRows(first.day, last.day, 'month', rows))
    }
    rows = []
  }

  for (const day of days) {
    const nextMonth = day.day.slice(0, 7)
    if (month != null && nextMonth !== month) flush()
    month = nextMonth
    rows.push(day)
  }
  flush()
  return buckets
}

function combineRows(
  from: string,
  to: string,
  granularity: Exclude<AnalyticsChartGranularity, 'day'>,
  rows: readonly AnalyticsSummaryDay[]
): AnalyticsChartBucket {
  let views = 0
  let visitors = 0
  let downloads = 0
  for (const row of rows) {
    views += row.views
    visitors += row.visitors
    downloads += row.downloads
  }
  return { from, to, granularity, dayCount: rows.length, views, visitors, downloads }
}
