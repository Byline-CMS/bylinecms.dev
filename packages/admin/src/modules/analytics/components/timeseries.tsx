'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * The analytics timeseries — one column per UTC day.
 *
 * A column per day rather than a continuous line is a claim about the data,
 * not a style: the rows behind this chart are daily aggregates and visitor
 * hashes rotate at UTC midnight, so nothing is measured *between* two points.
 * A line would invite reading a cross-day visitor count that does not exist.
 * Each day's unique visitors render as a narrower column inset inside that
 * day's views, so the two series share one mark without implying a total.
 *
 * This module is the deliberate seam for the renderer. Everything outside it
 * passes plain `AnalyticsSummaryDay[]`, so replacing the hand-drawn SVG with a
 * charting library is a change to this file alone. `buildAnalyticsColumns` is
 * pure and carries the geometry contract.
 */
import type React from 'react'
import { useMemo, useRef, useState } from 'react'

import type { AnalyticsSummaryDay } from '@byline/analytics'
import { useTranslation } from '@byline/i18n/react'
import cx from 'clsx'

import styles from './timeseries.module.css'

/** Drawn in a fixed user-space box and stretched to the container width. */
const VIEWBOX_WIDTH = 900
const VIEWBOX_HEIGHT = 180
const COLUMN_GAP_RATIO = 0.38
const MAX_COLUMN_WIDTH = 26

export interface AnalyticsColumn {
  index: number
  /** Full-height mark: that day's page views. */
  x: number
  width: number
  y: number
  height: number
  /** Inset mark: that day's unique visitors, always ≤ the views column. */
  insetX: number
  insetWidth: number
  insetY: number
  insetHeight: number
  /** Full-height transparent target, so narrow columns stay easy to hit. */
  hitX: number
  hitWidth: number
}

/**
 * Project a day series into column geometry. Heights are scaled against the
 * highest view count in the window, so an empty window still yields zero-height
 * columns rather than dividing by zero.
 */
export function buildAnalyticsColumns(
  days: readonly AnalyticsSummaryDay[]
): readonly AnalyticsColumn[] {
  if (days.length === 0) return []
  const ceiling = Math.max(1, ...days.map((day) => day.views))
  const step = VIEWBOX_WIDTH / days.length
  const width = Math.max(2, Math.min(step * (1 - COLUMN_GAP_RATIO), MAX_COLUMN_WIDTH))

  return days.map((day, index) => {
    const centre = index * step + step / 2
    const height = (day.views / ceiling) * VIEWBOX_HEIGHT
    const insetHeight = (day.visitors / ceiling) * VIEWBOX_HEIGHT
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
  locale: string
}

export function AnalyticsTimeseries({ days, locale }: AnalyticsTimeseriesProps): React.JSX.Element {
  const { t } = useTranslation('byline-admin')
  const [hovered, setHovered] = useState<number | null>(null)
  const plot = useRef<SVGSVGElement | null>(null)

  const columns = useMemo(() => buildAnalyticsColumns(days), [days])
  const numbers = useMemo(() => new Intl.NumberFormat(locale), [locale])
  // Days are UTC calendar days; formatting in the viewer's zone would relabel
  // them and shift the axis by up to a day.
  const dayLabel = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    [locale]
  )

  const format = (day: string) => dayLabel.format(new Date(`${day}T00:00:00.000Z`))
  const active = hovered == null ? undefined : days[hovered]
  const readDay = (row: AnalyticsSummaryDay) =>
    [
      format(row.day),
      `${t('analytics.stats.views')} ${numbers.format(row.views)}`,
      `${t('analytics.stats.dailyUniques')} ${numbers.format(row.visitors)}`,
      `${t('analytics.stats.downloads')} ${numbers.format(row.downloads)}`,
    ].join(', ')

  // One handler on the plot rather than one per column: with a 90-day window
  // that is 90 listeners saved, and it keeps the columns non-interactive so
  // the keyboard path below is the only way in besides the pointer.
  const trackPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (days.length === 0 || plot.current == null) return
    const bounds = plot.current.getBoundingClientRect()
    if (bounds.width === 0) return
    const ratio = (event.clientX - bounds.left) / bounds.width
    setHovered(Math.min(days.length - 1, Math.max(0, Math.floor(ratio * days.length))))
  }

  // Arrow keys walk the same readout the pointer drives, so the per-day figures
  // are reachable without a mouse. The plot is one tab stop, not ninety.
  const trackKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (days.length === 0) return
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0 && event.key !== 'Home' && event.key !== 'End' && event.key !== 'Escape') return
    event.preventDefault()
    if (event.key === 'Escape') return setHovered(null)
    if (event.key === 'Home') return setHovered(0)
    if (event.key === 'End') return setHovered(days.length - 1)
    setHovered((current) => {
      const next = (current ?? (step > 0 ? -1 : days.length)) + step
      return Math.min(days.length - 1, Math.max(0, next))
    })
  }

  return (
    <div
      className={cx('byline-analytics-timeseries', styles.root)}
      role="slider"
      tabIndex={0}
      aria-label={t('analytics.chart.views')}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, days.length - 1)}
      aria-valuenow={hovered ?? 0}
      aria-valuetext={active == null ? t('analytics.chart.hint') : readDay(active)}
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
            key={days[column.index]?.day}
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

      {/* The axis lives in HTML rather than the SVG: the chart stretches to the
          container with `preserveAspectRatio="none"`, which would distort any
          text drawn inside it. */}
      <div className={cx('byline-analytics-axis', styles.axis)} aria-hidden="true">
        <span>{days.length > 0 && days[0] != null ? format(days[0].day) : ''}</span>
        <span>
          {days.length > 0 && days[days.length - 1] != null
            ? format(days[days.length - 1]?.day ?? '')
            : ''}
        </span>
      </div>

      <p className={cx('byline-analytics-readout', styles.readout)} aria-live="polite">
        {active == null ? (
          t('analytics.chart.hint')
        ) : (
          <>
            <strong>{format(active.day)}</strong>
            <span className={styles.swatchViews} />
            {t('analytics.stats.views')} {numbers.format(active.views)}
            <span className={styles.swatchVisitors} />
            {t('analytics.stats.dailyUniques')} {numbers.format(active.visitors)}
            <span className={styles.swatchDownloads} />
            {t('analytics.stats.downloads')} {numbers.format(active.downloads)}
          </>
        )}
      </p>
    </div>
  )
}
