'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'
import { useEffect, useMemo, useState } from 'react'

import {
  ANALYTICS_DASHBOARD_PERIODS,
  ANALYTICS_OVERFLOW_KEY,
  isAnalyticsDashboardPeriod,
} from '@byline/analytics/config'
import { ANALYTICS_IGNORE_STORAGE_KEY } from '@byline/analytics-agent'
import { useTranslation } from '@byline/i18n/react'
import { Button, Card, Container, Section, Select } from '@byline/ui/react'
import cx from 'clsx'

import styles from './dashboard.module.css'
import { AnalyticsTimeseries, resolveAnalyticsChartGranularity } from './timeseries.js'
import type { AnalyticsDashboardData, AnalyticsDashboardPeriod } from '../types.js'

export interface AnalyticsDashboardProps {
  data: AnalyticsDashboardData
  period: AnalyticsDashboardPeriod
  onPeriodChange(period: AnalyticsDashboardPeriod): void
}

export function AnalyticsDashboard({
  data,
  period,
  onPeriodChange,
}: AnalyticsDashboardProps): React.JSX.Element {
  const { locale, t } = useTranslation('byline-admin')
  const [excluded, setExcluded] = useState(false)
  const numbers = useMemo(() => new Intl.NumberFormat(locale), [locale])

  useEffect(() => {
    try {
      setExcluded(localStorage.getItem(ANALYTICS_IGNORE_STORAGE_KEY) != null)
    } catch {
      setExcluded(false)
    }
  }, [])

  const toggleExclusion = () => {
    try {
      if (excluded) localStorage.removeItem(ANALYTICS_IGNORE_STORAGE_KEY)
      else localStorage.setItem(ANALYTICS_IGNORE_STORAGE_KEY, '1')
      setExcluded(!excluded)
    } catch {
      // A blocked storage surface leaves the current collection behavior unchanged.
    }
  }

  const periodItems = ANALYTICS_DASHBOARD_PERIODS.map((value) => ({
    value: String(value),
    label:
      typeof value === 'number'
        ? t('analytics.period.days', { count: value })
        : t(`analytics.period.${value}`),
  }))

  const { views, visitors, downloads } = data.summary
  const days = data.summary.timeseries.length
  const chartGranularity = resolveAnalyticsChartGranularity(period, days)

  return (
    <Section>
      <Container>
        <header className={cx('byline-analytics-header', styles.header)}>
          <div>
            <h1 className={cx('byline-analytics-title', styles.title)}>{t('analytics.title')}</h1>
            <p className={cx('muted', 'byline-analytics-help', styles.help)}>
              {t('analytics.dailyUniquesHelp')}
            </p>
          </div>
          <div className={cx('byline-analytics-controls', styles.controls)}>
            <Select<string>
              id="analytics-period"
              name="analytics-period"
              aria-label={t('analytics.period.label')}
              size="sm"
              value={String(period)}
              items={periodItems}
              onValueChange={(value) => {
                const next = value === 'ytd' || value === 'all' ? value : Number(value)
                if (isAnalyticsDashboardPeriod(next)) onPeriodChange(next)
              }}
            />
            <Button
              type="button"
              size="sm"
              aria-pressed={excluded}
              // Local storage is origin-scoped, so this only governs public-page
              // collection when the admin and the public site share an origin.
              title={t('analytics.exclusion.help')}
              onClick={toggleExclusion}
            >
              {excluded ? t('analytics.exclusion.include') : t('analytics.exclusion.exclude')}
            </Button>
          </div>
        </header>

        {/* Tinted ground, saturated ink, tracked label, tabular number — the
            same tile grammar as the collection dashboard's status counts. */}
        <div className={cx('byline-analytics-stats', styles.stats)}>
          <StatTile
            tone="views"
            label={t('analytics.stats.views')}
            value={numbers.format(views)}
            foot={t('analytics.stats.perDay', {
              count: days === 0 ? 0 : Math.round(views / days),
            })}
          />
          <StatTile
            tone="visitors"
            label={t('analytics.stats.dailyUniques')}
            value={numbers.format(visitors)}
            // The qualification rides under the figure it qualifies rather
            // than sitting in help text several elements away.
            foot={t('analytics.stats.sumOfDays', { count: days })}
          />
          <StatTile
            tone="downloads"
            label={t('analytics.stats.downloads')}
            value={numbers.format(downloads)}
            foot={t('analytics.stats.shareOfViews', {
              share: formatShare(downloads, views, locale),
            })}
          />
        </div>

        <Card className={cx('byline-analytics-chart-card', styles.chartCard)}>
          <Card.Header>
            <Card.Title>
              {chartGranularity === 'day'
                ? t('analytics.chart.perDay')
                : chartGranularity === 'seven-day'
                  ? t('analytics.chart.perSevenDays')
                  : t('analytics.chart.perMonth')}
            </Card.Title>
          </Card.Header>
          <Card.Content>
            <AnalyticsTimeseries
              days={data.summary.timeseries}
              granularity={chartGranularity}
              locale={locale}
            />
          </Card.Content>
        </Card>

        {/* Top pages is the list people actually read, so it gets the wide
            column; referrers and countries stack beside it. */}
        <div className={cx('byline-analytics-lists', styles.lists)}>
          <RankedList
            title={t('analytics.sections.pages')}
            caption={t('analytics.columns.viewsAndUniques')}
            tone="views"
            locale={locale}
            rows={data.pages.rows.map(toPathRow)}
            total={data.pages.total}
            coverageFrom={partialCoverageFrom(data.range.from, data.coverage.pathsFrom)}
          />
          <div className={styles.stack}>
            <RankedList
              title={t('analytics.sections.referrers')}
              tone="visitors"
              locale={locale}
              total={data.referrers.total}
              coverageFrom={partialCoverageFrom(data.range.from, data.coverage.referrersFrom)}
              rows={data.referrers.rows.map((row) => ({
                key: row.referrerHost,
                label: row.referrerHost,
                value: row.views,
                visitors: row.visitors,
                overflow: row.referrerHost === ANALYTICS_OVERFLOW_KEY,
              }))}
            />
            <RankedList
              title={t('analytics.sections.countries')}
              tone="visitors"
              locale={locale}
              rows={data.countries.map((row) => ({
                key: row.country,
                label: row.country,
                value: row.views,
                visitors: row.visitors,
                overflow: false,
              }))}
            />
          </div>
        </div>

        <RankedList
          title={t('analytics.sections.downloads')}
          caption={t('analytics.columns.clicksAndUniques')}
          tone="downloads"
          locale={locale}
          rows={data.downloads.rows.map(toPathRow)}
          total={data.downloads.total}
          coverageFrom={partialCoverageFrom(data.range.from, data.coverage.pathsFrom)}
        />
      </Container>
    </Section>
  )
}

type AnalyticsTone = 'views' | 'visitors' | 'downloads'

const TONE_TILE: Record<AnalyticsTone, string | undefined> = {
  views: styles.toneViews,
  visitors: styles.toneVisitors,
  downloads: styles.toneDownloads,
}

const TONE_BAR: Record<AnalyticsTone, string | undefined> = {
  views: styles.barViews,
  visitors: styles.barVisitors,
  downloads: styles.barDownloads,
}

function StatTile({
  tone,
  label,
  value,
  foot,
}: {
  tone: AnalyticsTone
  label: string
  value: string
  foot: string
}): React.JSX.Element {
  return (
    <div className={cx('byline-analytics-stat', styles.stat, TONE_TILE[tone])}>
      <span className={cx('byline-analytics-stat-label', styles.statLabel)}>{label}</span>
      <span className={cx('byline-analytics-stat-value', styles.statValue)}>{value}</span>
      <span className={cx('byline-analytics-stat-foot', styles.statFoot)}>{foot}</span>
    </div>
  )
}

interface RankedRow {
  key: string
  label: string
  value: number
  visitors: number
  overflow: boolean
}

function toPathRow(row: { path: string; views: number; visitors: number }): RankedRow {
  return {
    key: row.path,
    label: row.path,
    value: row.views,
    visitors: row.visitors,
    overflow: row.path === ANALYTICS_OVERFLOW_KEY,
  }
}

function RankedList({
  title,
  caption,
  rows,
  tone,
  locale,
  total,
  coverageFrom,
}: {
  title: string
  caption?: string
  rows: RankedRow[]
  tone: AnalyticsTone
  locale: string
  /** Distinct keys in the period; omit for lists that are never truncated. */
  total?: number
  /** First complete day when the selected report begins before retained rows. */
  coverageFrom?: string
}): React.JSX.Element {
  const { t } = useTranslation('byline-admin')
  const numbers = useMemo(() => new Intl.NumberFormat(locale), [locale])
  const ceiling = Math.max(1, ...rows.map((row) => row.value))
  // Say so when the list is a top-N slice. Without this the card presents a
  // truncated ranking as though it were the whole set.
  const truncated = total != null && total > rows.length
  const coverageDate = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeZone: 'UTC',
      }),
    [locale]
  )
  const description = [
    truncated ? t('analytics.topOf', { shown: rows.length, total }) : caption,
    coverageFrom == null
      ? undefined
      : t('analytics.coverage.since', {
          date: coverageDate.format(new Date(`${coverageFrom}T00:00:00.000Z`)),
        }),
  ]
    .filter((value): value is string => value != null)
    .join(' · ')

  return (
    <Card className={cx('byline-analytics-list', styles.list)}>
      <Card.Header>
        <Card.Title>{title}</Card.Title>
        {description.length > 0 && <Card.Description>{description}</Card.Description>}
      </Card.Header>
      <Card.Content>
        {rows.length === 0 ? (
          <p className="muted">{t('analytics.empty')}</p>
        ) : (
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
        )}
      </Card.Content>
    </Card>
  )
}

/** Never collapse the bar entirely: a visible sliver still encodes "smallest". */
export function shareWidth(value: number, ceiling: number): number {
  if (!Number.isFinite(value) || value <= 0 || ceiling <= 0) return 0
  return Math.max(3, Math.min(100, (value / ceiling) * 100))
}

export function formatShare(part: number, whole: number, locale: string): string {
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 })
  return percent.format(whole <= 0 ? 0 : part / whole)
}

/** Return the retained boundary only when it truncates the selected range. */
export function partialCoverageFrom(
  rangeFrom: string,
  coverageFrom: string | null
): string | undefined {
  return coverageFrom != null && coverageFrom > rangeFrom ? coverageFrom : undefined
}
