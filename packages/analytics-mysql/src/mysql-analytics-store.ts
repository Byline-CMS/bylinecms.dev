/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  type AnalyticsCountryTotal,
  type AnalyticsDateRange,
  type AnalyticsDeleteEventsOptions,
  type AnalyticsEvent,
  type AnalyticsLimitQuery,
  type AnalyticsPathTotal,
  type AnalyticsPruneOptions,
  type AnalyticsPruneResult,
  type AnalyticsRankedTotals,
  type AnalyticsReferrerTotal,
  type AnalyticsRollupDayOptions,
  type AnalyticsStore,
  type AnalyticsSummaryDay,
  type AnalyticsTopQuery,
  addAnalyticsDays,
  assertAnalyticsDay,
} from '@byline/analytics'
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

interface SaltRow extends RowDataPacket {
  salt: Buffer
}

interface DayRow extends RowDataPacket {
  day: string | null
}

interface CountRow extends RowDataPacket {
  views: string | number
  visitors: string | number
}

interface SummaryRow extends CountRow {
  day: string
  downloads: string | number
}

interface PathRow extends CountRow {
  path: string
  total: string | number
}

interface ReferrerRow extends CountRow {
  referrer_host: string
  total: string | number
}

interface CountryRow extends CountRow {
  country: string
}

export class MySqlAnalyticsStore implements AnalyticsStore {
  constructor(readonly pool: Pool) {}

  async getOrCreateDailySalt(day: string, candidate: Uint8Array): Promise<Uint8Array> {
    assertAnalyticsDay(day)
    await this.pool.query(
      `INSERT INTO byline_analytics_salt (day, salt) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE day = day`,
      [day, Buffer.from(candidate)]
    )
    const [rows] = await this.pool.query<SaltRow[]>(
      'SELECT salt FROM byline_analytics_salt WHERE day = ?',
      [day]
    )
    const salt = rows[0]?.salt
    if (salt == null) throw new Error('[analytics-mysql] daily salt insert/read returned no row')
    return Uint8Array.from(salt)
  }

  async insertEvent(event: AnalyticsEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO byline_analytics_event
        (occurred_at, kind, source, path, visitor_hash, referrer_host, country)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        mysqlUtcTimestamp(event.occurredAt),
        event.kind,
        event.source,
        event.path,
        event.visitorHash,
        event.referrerHost,
        event.country,
      ]
    )
  }

  async getRollupCursor(): Promise<string | null> {
    const [rows] = await this.pool.query<DayRow[]>(
      `SELECT DATE_FORMAT(last_complete_day, '%Y-%m-%d') AS day
       FROM byline_analytics_rollup_state WHERE singleton = 1`
    )
    return rows[0]?.day == null ? null : dayString(rows[0].day)
  }

  async getEarliestEventDay(): Promise<string | null> {
    const [rows] = await this.pool.query<DayRow[]>(
      `SELECT DATE_FORMAT(MIN(DATE(occurred_at)), '%Y-%m-%d') AS day
       FROM byline_analytics_event`
    )
    return rows[0]?.day == null ? null : dayString(rows[0].day)
  }

  async getEarliestReportDay(): Promise<string | null> {
    const [rows] = await this.pool.query<DayRow[]>(
      `SELECT DATE_FORMAT(MIN(day), '%Y-%m-%d') AS day
       FROM (
         SELECT day FROM byline_analytics_daily_site
         UNION ALL
         SELECT DATE(occurred_at) AS day FROM byline_analytics_event
       ) AS reportable_days`
    )
    return rows[0]?.day == null ? null : dayString(rows[0].day)
  }

  async rebuildDay(options: AnalyticsRollupDayOptions): Promise<void> {
    const day = assertAnalyticsDay(options.day)
    const nextDay = addAnalyticsDays(day, 1)
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      await deleteDailyRows(connection, day)
      await insertPathRollups(connection, day, nextDay, options.pathCardinalityCap)
      await insertSiteRollup(connection, day, nextDay)
      await insertReferrerRollups(connection, day, nextDay, options.referrerCardinalityCap)
      await insertCountryRollups(connection, day, nextDay)
      if (options.advanceCursor) {
        await connection.query(
          `INSERT INTO byline_analytics_rollup_state (singleton, last_complete_day)
           VALUES (1, ?)
           ON DUPLICATE KEY UPDATE last_complete_day =
             IF(last_complete_day IS NULL, VALUES(last_complete_day),
               GREATEST(last_complete_day, VALUES(last_complete_day)))`,
          [day]
        )
      }
      await connection.commit()
    } catch (error) {
      await rollback(connection)
      throw error
    } finally {
      connection.release()
    }
  }

  async prune(options: AnalyticsPruneOptions): Promise<AnalyticsPruneResult> {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const [events] = await connection.query<ResultSetHeader>(
        'DELETE FROM byline_analytics_event WHERE occurred_at < ?',
        [mysqlUtcTimestamp(options.eventsBefore)]
      )
      const [salts] = await connection.query<ResultSetHeader>(
        'DELETE FROM byline_analytics_salt WHERE day < ?',
        [options.saltsBefore]
      )
      const paths =
        options.pathAggregatesBefore == null
          ? null
          : (
              await connection.query<ResultSetHeader>(
                'DELETE FROM byline_analytics_daily_path WHERE day < ?',
                [options.pathAggregatesBefore]
              )
            )[0]
      const referrers =
        options.referrerAggregatesBefore == null
          ? null
          : (
              await connection.query<ResultSetHeader>(
                'DELETE FROM byline_analytics_daily_referrer WHERE day < ?',
                [options.referrerAggregatesBefore]
              )
            )[0]
      await connection.commit()
      return {
        events: events.affectedRows,
        salts: salts.affectedRows,
        pathAggregates: paths?.affectedRows ?? 0,
        referrerAggregates: referrers?.affectedRows ?? 0,
      }
    } catch (error) {
      await rollback(connection)
      throw error
    } finally {
      connection.release()
    }
  }

  async getSummary(range: AnalyticsDateRange): Promise<AnalyticsSummaryDay[]> {
    const [rows] = await this.pool.query<SummaryRow[]>(summarySql, [
      range.from,
      range.to,
      range.from,
      range.to,
    ])
    const byDay = new Map(
      rows.map((row) => [
        dayString(row.day),
        {
          day: dayString(row.day),
          views: count(row.views),
          visitors: count(row.visitors),
          downloads: count(row.downloads),
        },
      ])
    )
    const result: AnalyticsSummaryDay[] = []
    for (let day = range.from; day <= range.to; day = addAnalyticsDays(day, 1)) {
      result.push(byDay.get(day) ?? { day, views: 0, visitors: 0, downloads: 0 })
    }
    return result
  }

  async getTopPaths(
    query: Required<AnalyticsTopQuery>
  ): Promise<AnalyticsRankedTotals<AnalyticsPathTotal>> {
    const [rows] = await this.pool.query<PathRow[]>(topPathsSql, [
      query.from,
      query.to,
      query.kind,
      query.from,
      query.to,
      query.kind,
      query.limit,
    ])
    return {
      rows: rows.map((row) => ({
        path: row.path,
        views: count(row.views),
        visitors: count(row.visitors),
      })),
      total: count(rows[0]?.total ?? 0),
    }
  }

  async getReferrers(
    query: Required<AnalyticsLimitQuery>
  ): Promise<AnalyticsRankedTotals<AnalyticsReferrerTotal>> {
    const [rows] = await this.pool.query<ReferrerRow[]>(referrersSql, [
      query.from,
      query.to,
      query.from,
      query.to,
      query.limit,
    ])
    return {
      rows: rows.map((row) => ({
        referrerHost: row.referrer_host,
        views: count(row.views),
        visitors: count(row.visitors),
      })),
      total: count(rows[0]?.total ?? 0),
    }
  }

  async getCountries(range: AnalyticsDateRange): Promise<AnalyticsCountryTotal[]> {
    const [rows] = await this.pool.query<CountryRow[]>(countriesSql, [
      range.from,
      range.to,
      range.from,
      range.to,
    ])
    return rows.map((row) => ({
      country: row.country,
      views: count(row.views),
      visitors: count(row.visitors),
    }))
  }

  async deleteEvents(options: AnalyticsDeleteEventsOptions): Promise<number> {
    const params: unknown[] = [mysqlUtcTimestamp(options.from), mysqlUtcTimestamp(options.to)]
    const visitor = options.visitorHash == null ? '' : ' AND visitor_hash = ?'
    if (options.visitorHash != null) params.push(options.visitorHash)
    const [result] = await this.pool.query<ResultSetHeader>(
      `DELETE FROM byline_analytics_event
       WHERE occurred_at >= ? AND occurred_at < ?${visitor}`,
      params
    )
    return result.affectedRows
  }
}

async function deleteDailyRows(connection: PoolConnection, day: string): Promise<void> {
  for (const table of [
    'byline_analytics_daily_path',
    'byline_analytics_daily_site',
    'byline_analytics_daily_referrer',
    'byline_analytics_daily_country',
  ]) {
    await connection.query(`DELETE FROM ${table} WHERE day = ?`, [day])
  }
}

async function insertPathRollups(
  connection: PoolConnection,
  day: string,
  nextDay: string,
  cap: number
): Promise<void> {
  await connection.query(
    `INSERT INTO byline_analytics_daily_path (day, kind, path, views, visitors)
     WITH grouped AS (
       SELECT kind, path, COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors
       FROM byline_analytics_event
       WHERE occurred_at >= ? AND occurred_at < ?
       GROUP BY kind, path
     ), ranked AS (
       SELECT grouped.*,
         ROW_NUMBER() OVER (PARTITION BY kind ORDER BY views DESC, path ASC) AS row_rank
       FROM grouped
     )
     SELECT ?, kind, path, views, visitors FROM ranked WHERE row_rank <= ?`,
    [day, nextDay, day, cap]
  )
  await connection.query(
    `INSERT INTO byline_analytics_daily_path (day, kind, path, views, visitors)
     WITH grouped AS (
       SELECT kind, path, COUNT(*) AS views
       FROM byline_analytics_event
       WHERE occurred_at >= ? AND occurred_at < ?
       GROUP BY kind, path
     ), ranked AS (
       SELECT kind, path,
         ROW_NUMBER() OVER (PARTITION BY kind ORDER BY views DESC, path ASC) AS row_rank
       FROM grouped
     )
     SELECT ?, event.kind, '__other__', COUNT(*), COUNT(DISTINCT event.visitor_hash)
     FROM byline_analytics_event event
     JOIN ranked ON ranked.kind = event.kind AND ranked.path = event.path
     WHERE event.occurred_at >= ? AND event.occurred_at < ? AND ranked.row_rank > ?
     GROUP BY event.kind`,
    [day, nextDay, day, day, nextDay, cap]
  )
}

async function insertSiteRollup(
  connection: PoolConnection,
  day: string,
  nextDay: string
): Promise<void> {
  await connection.query(
    `INSERT INTO byline_analytics_daily_site (day, views, visitors, downloads)
     SELECT ?,
       COALESCE(SUM(kind = 'page'), 0),
       COUNT(DISTINCT CASE WHEN kind = 'page' THEN visitor_hash END),
       COALESCE(SUM(kind = 'download'), 0)
     FROM byline_analytics_event
     WHERE occurred_at >= ? AND occurred_at < ?`,
    [day, day, nextDay]
  )
}

async function insertReferrerRollups(
  connection: PoolConnection,
  day: string,
  nextDay: string,
  cap: number
): Promise<void> {
  await connection.query(
    `INSERT INTO byline_analytics_daily_referrer (day, referrer_host, views, visitors)
     WITH grouped AS (
       SELECT referrer_host, COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors
       FROM byline_analytics_event
       WHERE occurred_at >= ? AND occurred_at < ?
         AND kind = 'page' AND referrer_host IS NOT NULL
       GROUP BY referrer_host
     ), ranked AS (
       SELECT grouped.*, ROW_NUMBER() OVER (ORDER BY views DESC, referrer_host ASC) AS row_rank
       FROM grouped
     )
     SELECT ?, referrer_host, views, visitors FROM ranked WHERE row_rank <= ?`,
    [day, nextDay, day, cap]
  )
  await connection.query(
    `INSERT INTO byline_analytics_daily_referrer (day, referrer_host, views, visitors)
     WITH grouped AS (
       SELECT referrer_host, COUNT(*) AS views
       FROM byline_analytics_event
       WHERE occurred_at >= ? AND occurred_at < ?
         AND kind = 'page' AND referrer_host IS NOT NULL
       GROUP BY referrer_host
     ), ranked AS (
       SELECT referrer_host, ROW_NUMBER() OVER (ORDER BY views DESC, referrer_host ASC) AS row_rank
       FROM grouped
     )
     SELECT ?, '__other__', COUNT(*), COUNT(DISTINCT event.visitor_hash)
     FROM byline_analytics_event event
     JOIN ranked ON ranked.referrer_host = event.referrer_host
     WHERE event.occurred_at >= ? AND event.occurred_at < ?
       AND event.kind = 'page' AND ranked.row_rank > ?
     HAVING COUNT(*) > 0`,
    [day, nextDay, day, day, nextDay, cap]
  )
}

async function insertCountryRollups(
  connection: PoolConnection,
  day: string,
  nextDay: string
): Promise<void> {
  await connection.query(
    `INSERT INTO byline_analytics_daily_country (day, country, views, visitors)
     SELECT ?, country, COUNT(*), COUNT(DISTINCT visitor_hash)
     FROM byline_analytics_event
     WHERE occurred_at >= ? AND occurred_at < ?
       AND kind = 'page' AND country IS NOT NULL
     GROUP BY country`,
    [day, day, nextDay]
  )
}

const summarySql = `WITH state AS (
  SELECT last_complete_day FROM byline_analytics_rollup_state WHERE singleton = 1
), per_day AS (
  SELECT site.day, site.views, site.visitors, site.downloads
  FROM byline_analytics_daily_site site
  WHERE site.day BETWEEN ? AND ?
    AND site.day <= (SELECT last_complete_day FROM state)
  UNION ALL
  SELECT DATE(event.occurred_at),
    SUM(event.kind = 'page'),
    COUNT(DISTINCT CASE WHEN event.kind = 'page' THEN event.visitor_hash END),
    SUM(event.kind = 'download')
  FROM byline_analytics_event event
  WHERE event.occurred_at >= ? AND event.occurred_at < DATE_ADD(?, INTERVAL 1 DAY)
    AND ((SELECT last_complete_day FROM state) IS NULL OR
      DATE(event.occurred_at) > (SELECT last_complete_day FROM state))
  GROUP BY DATE(event.occurred_at)
)
SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day,
  SUM(views) AS views, SUM(visitors) AS visitors, SUM(downloads) AS downloads
FROM per_day GROUP BY day ORDER BY day`

const topPathsSql = `WITH state AS (
  SELECT last_complete_day FROM byline_analytics_rollup_state WHERE singleton = 1
), per_day AS (
  SELECT path.day, path.path, path.views, path.visitors
  FROM byline_analytics_daily_path path
  WHERE path.day BETWEEN ? AND ? AND path.kind = ?
    AND path.day <= (SELECT last_complete_day FROM state)
  UNION ALL
  SELECT DATE(event.occurred_at), event.path, COUNT(*), COUNT(DISTINCT event.visitor_hash)
  FROM byline_analytics_event event
  WHERE event.occurred_at >= ? AND event.occurred_at < DATE_ADD(?, INTERVAL 1 DAY)
    AND event.kind = ?
    AND ((SELECT last_complete_day FROM state) IS NULL OR
      DATE(event.occurred_at) > (SELECT last_complete_day FROM state))
  GROUP BY DATE(event.occurred_at), event.path
)
SELECT path, SUM(views) AS views, SUM(visitors) AS visitors,
  COUNT(*) OVER () AS total
FROM per_day GROUP BY path ORDER BY views DESC, path ASC LIMIT ?`

const referrersSql = `WITH state AS (
  SELECT last_complete_day FROM byline_analytics_rollup_state WHERE singleton = 1
), per_day AS (
  SELECT ref.day, ref.referrer_host, ref.views, ref.visitors
  FROM byline_analytics_daily_referrer ref
  WHERE ref.day BETWEEN ? AND ? AND ref.day <= (SELECT last_complete_day FROM state)
  UNION ALL
  SELECT DATE(event.occurred_at), event.referrer_host,
    COUNT(*), COUNT(DISTINCT event.visitor_hash)
  FROM byline_analytics_event event
  WHERE event.occurred_at >= ? AND event.occurred_at < DATE_ADD(?, INTERVAL 1 DAY)
    AND event.kind = 'page' AND event.referrer_host IS NOT NULL
    AND ((SELECT last_complete_day FROM state) IS NULL OR
      DATE(event.occurred_at) > (SELECT last_complete_day FROM state))
  GROUP BY DATE(event.occurred_at), event.referrer_host
)
SELECT referrer_host, SUM(views) AS views, SUM(visitors) AS visitors,
  COUNT(*) OVER () AS total
FROM per_day GROUP BY referrer_host ORDER BY views DESC, referrer_host ASC LIMIT ?`

const countriesSql = `WITH state AS (
  SELECT last_complete_day FROM byline_analytics_rollup_state WHERE singleton = 1
), per_day AS (
  SELECT country.day, country.country, country.views, country.visitors
  FROM byline_analytics_daily_country country
  WHERE country.day BETWEEN ? AND ? AND country.day <= (SELECT last_complete_day FROM state)
  UNION ALL
  SELECT DATE(event.occurred_at), event.country, COUNT(*), COUNT(DISTINCT event.visitor_hash)
  FROM byline_analytics_event event
  WHERE event.occurred_at >= ? AND event.occurred_at < DATE_ADD(?, INTERVAL 1 DAY)
    AND event.kind = 'page' AND event.country IS NOT NULL
    AND ((SELECT last_complete_day FROM state) IS NULL OR
      DATE(event.occurred_at) > (SELECT last_complete_day FROM state))
  GROUP BY DATE(event.occurred_at), event.country
)
SELECT country, SUM(views) AS views, SUM(visitors) AS visitors
FROM per_day GROUP BY country ORDER BY views DESC, country ASC`

function count(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`[analytics-mysql] count is outside JavaScript's safe integer range: ${value}`)
  }
  return parsed
}

function dayString(value: string): string {
  return value.slice(0, 10)
}

function mysqlUtcTimestamp(value: Date): string {
  if (Number.isNaN(value.valueOf())) throw new Error('[analytics-mysql] timestamp must be valid')
  return value.toISOString().slice(0, -1).replace('T', ' ')
}

async function rollback(connection: PoolConnection): Promise<void> {
  try {
    await connection.rollback()
  } catch {
    // Preserve the original transaction error.
  }
}
