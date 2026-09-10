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

import type {
  AnalyticsPathTotal,
  AnalyticsRankedTotals,
  AnalyticsReferrerTotal,
} from '@byline/analytics'
import {
  ANALYTICS_DASHBOARD_PERIODS,
  ANALYTICS_OVERFLOW_KEY,
  isAnalyticsDashboardPeriod,
} from '@byline/analytics/config'
import { ANALYTICS_IGNORE_STORAGE_KEY } from '@byline/analytics-agent'
import { useTranslation } from '@byline/i18n/react'
import { Button, Card, Container, Section, Select, useModal } from '@byline/ui/react'
import cx from 'clsx'

import styles from './dashboard.module.css'
import { RankedListModal, type RankedListSourceInput } from './ranked-list-modal.js'
import { type AnalyticsTone, type RankedRow, RankingRows, regionName } from './ranking.js'
import { AnalyticsTimeseries, resolveAnalyticsChartGranularity } from './timeseries.js'
import type { AnalyticsDashboardData, AnalyticsDashboardPeriod } from '../types.js'

export { shareWidth } from './ranking.js'

/** Rows each ranked card shows before offering the full list. */
export const ANALYTICS_PREVIEW_ROWS = 10

/** The truncated lists a host can fetch in full on demand. */
export type AnalyticsFullListKind = 'pages' | 'downloads' | 'referrers'

export interface AnalyticsDashboardProps {
  data: AnalyticsDashboardData
  period: AnalyticsDashboardPeriod
  onPeriodChange(period: AnalyticsDashboardPeriod): void
  /**
   * Fetch a larger top-N for one of the truncated lists when its "View all"
   * modal opens. Countries are always complete and never use this. Omit it
   * and those cards still show their preview, without the action.
   */
  loadFullList?(
    kind: AnalyticsFullListKind
  ): Promise<AnalyticsRankedTotals<AnalyticsPathTotal | AnalyticsReferrerTotal>>
}

export function AnalyticsDashboard({
  data,
  period,
  onPeriodChange,
  loadFullList,
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

  // Each full-list loader is a stable closure per range so the modal's
  // effect does not refetch on every dashboard render.
  const fullLists = useMemo(() => {
    if (!loadFullList) return {}
    const load = (kind: AnalyticsFullListKind) => () =>
      loadFullList(kind).then((result) => ({
        rows: result.rows.map(toRankedRow),
        total: result.total,
      }))
    return { pages: load('pages'), downloads: load('downloads'), referrers: load('referrers') }
  }, [loadFullList])

  const countryRows = useMemo(
    () =>
      data.countries.map((row) => ({
        key: row.country,
        label: regionName(row.country, locale),
        value: row.views,
        visitors: row.visitors,
        overflow: false,
      })),
    [data.countries, locale]
  )

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
            column; referrers and countries stack beside it. Every card shows
            the same preview depth so the band stays even at any traffic. */}
        <div className={cx('byline-analytics-lists', styles.lists)}>
          <RankedList
            title={t('analytics.sections.pages')}
            caption={t('analytics.columns.viewsAndUniques')}
            tone="views"
            locale={locale}
            rows={data.pages.rows.map(toRankedRow)}
            total={data.pages.total}
            fullList={fullLists.pages}
            coverageFrom={partialCoverageFrom(data.range.from, data.coverage.pathsFrom)}
          />
          <div className={styles.stack}>
            <RankedList
              title={t('analytics.sections.referrers')}
              tone="visitors"
              locale={locale}
              rows={data.referrers.rows.map(toRankedRow)}
              total={data.referrers.total}
              fullList={fullLists.referrers}
              coverageFrom={partialCoverageFrom(data.range.from, data.coverage.referrersFrom)}
            />
            <RankedList
              title={t('analytics.sections.countries')}
              tone="visitors"
              locale={locale}
              rows={countryRows}
              total={countryRows.length}
              // Countries arrive complete, so the full list needs no fetch.
              fullList={{ rows: countryRows, total: countryRows.length }}
            />
          </div>
        </div>

        <RankedList
          title={t('analytics.sections.downloads')}
          caption={t('analytics.columns.clicksAndUniques')}
          tone="downloads"
          locale={locale}
          rows={data.downloads.rows.map(toRankedRow)}
          total={data.downloads.total}
          fullList={fullLists.downloads}
          coverageFrom={partialCoverageFrom(data.range.from, data.coverage.pathsFrom)}
        />
      </Container>
    </Section>
  )
}

const TONE_TILE: Record<AnalyticsTone, string | undefined> = {
  views: styles.toneViews,
  visitors: styles.toneVisitors,
  downloads: styles.toneDownloads,
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

/** Map a path or referrer total onto the shared row shape. */
function toRankedRow(row: AnalyticsPathTotal | AnalyticsReferrerTotal): RankedRow {
  const key = 'path' in row ? row.path : row.referrerHost
  return {
    key,
    label: key,
    value: row.views,
    visitors: row.visitors,
    overflow: key === ANALYTICS_OVERFLOW_KEY,
  }
}

function RankedList({
  title,
  caption,
  rows,
  tone,
  locale,
  total,
  fullList,
  coverageFrom,
}: {
  title: string
  caption?: string
  rows: RankedRow[]
  tone: AnalyticsTone
  locale: string
  /** Distinct keys in the period, before any top-N slice. */
  total: number
  /** The complete ranking, ready or fetched on demand; omit to offer no "View all". */
  fullList?: RankedListSourceInput
  /** First complete day when the selected report begins before retained rows. */
  coverageFrom?: string
}): React.JSX.Element {
  const { t } = useTranslation('byline-admin')
  const modal = useModal()
  const preview = rows.slice(0, ANALYTICS_PREVIEW_ROWS)
  // Say so when the card is a top-N slice. Without this the card presents a
  // truncated ranking as though it were the whole set.
  const truncated = total > preview.length
  const coverageDate = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeZone: 'UTC',
      }),
    [locale]
  )
  const description = [
    truncated ? t('analytics.topOf', { shown: preview.length, total }) : caption,
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
      <Card.Header className={cx('byline-analytics-list-header', styles.listHeader)}>
        <div className={styles.listHeading}>
          <Card.Title>{title}</Card.Title>
          {description.length > 0 && <Card.Description>{description}</Card.Description>}
        </div>
        {fullList != null && truncated && (
          <Button
            type="button"
            size="xs"
            variant="outlined"
            className={cx('byline-analytics-view-all', styles.viewAll)}
            onClick={modal.onOpen}
          >
            {t('analytics.viewAll', { count: total })}
          </Button>
        )}
      </Card.Header>
      <Card.Content>
        {preview.length === 0 ? (
          <p className="muted">{t('analytics.empty')}</p>
        ) : (
          <RankingRows rows={preview} tone={tone} locale={locale} />
        )}
      </Card.Content>
      {fullList != null && (
        <RankedListModal
          isOpen={modal.isOpen}
          onDismiss={modal.onDismiss}
          title={title}
          tone={tone}
          locale={locale}
          source={fullList}
        />
      )}
    </Card>
  )
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
