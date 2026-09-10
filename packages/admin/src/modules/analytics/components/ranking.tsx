'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Ranked-row rendering shared by the dashboard cards and the full-list
 * modal, plus the small pure helpers both rely on.
 */

import type React from 'react'
import { useMemo } from 'react'

import { useTranslation } from '@byline/i18n/react'
import cx from 'clsx'

import styles from './dashboard.module.css'

export type AnalyticsTone = 'views' | 'visitors' | 'downloads'

export interface RankedRow {
  key: string
  label: string
  value: number
  visitors: number
  overflow: boolean
}

/** A complete ranking plus the size of the set it was drawn from. */
export interface RankedListSource {
  rows: RankedRow[]
  total: number
}

const TONE_BAR: Record<AnalyticsTone, string | undefined> = {
  views: styles.barViews,
  visitors: styles.barVisitors,
  downloads: styles.barDownloads,
}

/** The ordered list with a share bar behind each row. Renders no card chrome. */
export function RankingRows({
  rows,
  tone,
  locale,
}: {
  rows: RankedRow[]
  tone: AnalyticsTone
  locale: string
}): React.JSX.Element {
  const { t } = useTranslation('byline-admin')
  const numbers = useMemo(() => new Intl.NumberFormat(locale), [locale])
  const ceiling = Math.max(1, ...rows.map((row) => row.value))
  return (
    <ol className={cx('byline-analytics-ranking', styles.ranking)}>
      {rows.map((row) => (
        <li
          key={row.key}
          className={cx(
            'byline-analytics-ranking-row',
            styles.rankingRow,
            TONE_BAR[tone],
            row.overflow && styles.rankingOverflow
          )}
          // The share bar sits behind the row so the label and its
          // magnitude occupy one line and are read together.
          style={
            {
              '--byline-analytics-share': `${shareWidth(row.value, ceiling)}%`,
            } as React.CSSProperties
          }
        >
          <span className={styles.rankingLabel} title={row.key}>
            {/* `__other__` is a reserved aggregate, not a page anyone
                visited — never render it as though it were a real path. */}
            {row.overflow ? t('analytics.overflow') : row.label}
          </span>
          <span className={styles.rankingValue}>{numbers.format(row.value)}</span>
          <span className={styles.rankingVisitors}>{numbers.format(row.visitors)}</span>
        </li>
      ))}
    </ol>
  )
}

/** Never collapse the bar entirely: a visible sliver still encodes "smallest". */
export function shareWidth(value: number, ceiling: number): number {
  if (!Number.isFinite(value) || value <= 0 || ceiling <= 0) return 0
  return Math.max(3, Math.min(100, (value / ceiling) * 100))
}

/** Row indices for one page of a list, with the page clamped into range. */
export function pageWindow(
  total: number,
  pageSize: number,
  page: number
): { start: number; end: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(Math.max(1, page), pageCount)
  const start = (current - 1) * pageSize
  return { start, end: Math.min(total, start + pageSize), pageCount }
}

/**
 * Localised region name for an ISO 3166-1 alpha-2 code, or the code itself
 * when the value is not a code or the runtime has no name for it. The
 * dashboard stores bare codes, so this is purely a display concern.
 */
export function regionName(code: string, locale: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return code
  try {
    const names = new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' })
    return names.of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}
