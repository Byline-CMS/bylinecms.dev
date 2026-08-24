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
  startOfAnalyticsDay,
} from '@byline/analytics'
import type { Pool, PoolClient, QueryResultRow } from 'pg'

interface CountRow extends QueryResultRow {
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

export class PostgresAnalyticsStore implements AnalyticsStore {
  constructor(readonly pool: Pool) {}

  async getOrCreateDailySalt(day: string, candidate: Uint8Array): Promise<Uint8Array> {
    assertAnalyticsDay(day)
    const result = await this.pool.query<{ salt: Buffer }>(
      `INSERT INTO byline_analytics_salt (day, salt)
       VALUES ($1::date, $2)
       ON CONFLICT (day) DO UPDATE
         SET salt = byline_analytics_salt.salt
       RETURNING salt`,
      [day, Buffer.from(candidate)]
    )
    const salt = result.rows[0]?.salt
    if (salt == null) throw new Error('[analytics-postgres] daily salt upsert returned no row')
    return Uint8Array.from(salt)
  }

  async insertEvent(event: AnalyticsEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO byline_analytics_event
        (occurred_at, kind, source, path, visitor_hash, referrer_host, country)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        event.occurredAt,
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
    const result = await this.pool.query<{ last_complete_day: string | null }>(
      `SELECT last_complete_day::text AS last_complete_day
       FROM byline_analytics_rollup_state WHERE singleton = 1`
    )
    return result.rows[0]?.last_complete_day ?? null
  }

  async getEarliestEventDay(): Promise<string | null> {
    const result = await this.pool.query<{ day: string | null }>(
      `SELECT min((occurred_at AT TIME ZONE 'UTC')::date)::text AS day
       FROM byline_analytics_event`
    )
    return result.rows[0]?.day ?? null
  }

  async getEarliestReportDay(): Promise<string | null> {
    const result = await this.pool.query<{ day: string | null }>(
      `SELECT min(day)::text AS day
       FROM (
         SELECT day FROM byline_analytics_daily_site
         UNION ALL
         SELECT (occurred_at AT TIME ZONE 'UTC')::date AS day
         FROM byline_analytics_event
       ) reportable_days`
    )
    return result.rows[0]?.day ?? null
  }

  async rebuildDay(options: AnalyticsRollupDayOptions): Promise<void> {
    const day = assertAnalyticsDay(options.day)
    const from = startOfAnalyticsDay(day)
    const to = startOfAnalyticsDay(addAnalyticsDays(day, 1))
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await deleteDailyRows(client, day)
      await insertPathRollups(client, day, from, to, options.pathCardinalityCap)
      await insertSiteRollup(client, day, from, to)
      await insertReferrerRollups(client, day, from, to, options.referrerCardinalityCap)
      await insertCountryRollups(client, day, from, to)
      if (options.advanceCursor) {
        await client.query(
          `INSERT INTO byline_analytics_rollup_state (singleton, last_complete_day)
           VALUES (1, $1::date)
           ON CONFLICT (singleton) DO UPDATE
           SET last_complete_day = GREATEST(
             byline_analytics_rollup_state.last_complete_day,
             EXCLUDED.last_complete_day
           )`,
          [day]
        )
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async prune(options: AnalyticsPruneOptions): Promise<AnalyticsPruneResult> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const events = await client.query(
        'DELETE FROM byline_analytics_event WHERE occurred_at < $1',
        [options.eventsBefore]
      )
      const salts = await client.query('DELETE FROM byline_analytics_salt WHERE day < $1::date', [
        options.saltsBefore,
      ])
      const paths =
        options.pathAggregatesBefore == null
          ? null
          : await client.query('DELETE FROM byline_analytics_daily_path WHERE day < $1::date', [
              options.pathAggregatesBefore,
            ])
      const referrers =
        options.referrerAggregatesBefore == null
          ? null
          : await client.query('DELETE FROM byline_analytics_daily_referrer WHERE day < $1::date', [
              options.referrerAggregatesBefore,
            ])
      await client.query('COMMIT')
      return {
        events: events.rowCount ?? 0,
        salts: salts.rowCount ?? 0,
        pathAggregates: paths?.rowCount ?? 0,
        referrerAggregates: referrers?.rowCount ?? 0,
      }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async getSummary(range: AnalyticsDateRange): Promise<AnalyticsSummaryDay[]> {
    const result = await this.pool.query<SummaryRow>(summarySql, [range.from, range.to])
    return result.rows.map((row) => ({
      day: row.day,
      views: count(row.views),
      visitors: count(row.visitors),
      downloads: count(row.downloads),
    }))
  }

  async getTopPaths(
    query: Required<AnalyticsTopQuery>
  ): Promise<AnalyticsRankedTotals<AnalyticsPathTotal>> {
    const result = await this.pool.query<PathRow>(topPathsSql, [
      query.from,
      query.to,
      query.kind,
      query.limit,
    ])
    return {
      rows: result.rows.map((row) => ({
        path: row.path,
        views: count(row.views),
        visitors: count(row.visitors),
      })),
      total: count(result.rows[0]?.total ?? 0),
    }
  }

  async getReferrers(
    query: Required<AnalyticsLimitQuery>
  ): Promise<AnalyticsRankedTotals<AnalyticsReferrerTotal>> {
    const result = await this.pool.query<ReferrerRow>(referrersSql, [
      query.from,
      query.to,
      query.limit,
    ])
    return {
      rows: result.rows.map((row) => ({
        referrerHost: row.referrer_host,
        views: count(row.views),
        visitors: count(row.visitors),
      })),
      total: count(result.rows[0]?.total ?? 0),
    }
  }

  async getCountries(range: AnalyticsDateRange): Promise<AnalyticsCountryTotal[]> {
    const result = await this.pool.query<CountryRow>(countriesSql, [range.from, range.to])
    return result.rows.map((row) => ({
      country: row.country,
      views: count(row.views),
      visitors: count(row.visitors),
    }))
  }

  async deleteEvents(options: AnalyticsDeleteEventsOptions): Promise<number> {
    const params: unknown[] = [options.from, options.to]
    const visitor =
      options.visitorHash == null ? '' : ` AND visitor_hash = $${params.push(options.visitorHash)}`
    const result = await this.pool.query(
      `DELETE FROM byline_analytics_event
       WHERE occurred_at >= $1 AND occurred_at < $2${visitor}`,
      params
    )
    return result.rowCount ?? 0
  }
}

async function deleteDailyRows(client: PoolClient, day: string): Promise<void> {
  for (const table of [
    'byline_analytics_daily_path',
    'byline_analytics_daily_site',
    'byline_analytics_daily_referrer',
    'byline_analytics_daily_country',
  ]) {
    await client.query(`DELETE FROM ${table} WHERE day = $1::date`, [day])
  }
}

async function insertPathRollups(
  client: PoolClient,
  day: string,
  from: Date,
  to: Date,
  cap: number
): Promise<void> {
  await client.query(
    `WITH grouped AS (
       SELECT kind, path, count(*) AS views, count(DISTINCT visitor_hash) AS visitors
       FROM byline_analytics_event
       WHERE occurred_at >= $2 AND occurred_at < $3
       GROUP BY kind, path
     ), ranked AS (
       SELECT *, row_number() OVER (PARTITION BY kind ORDER BY views DESC, path ASC) AS rank
       FROM grouped
     )
     INSERT INTO byline_analytics_daily_path (day, kind, path, views, visitors)
     SELECT $1::date, kind, path, views, visitors FROM ranked WHERE rank <= $4`,
    [day, from, to, cap]
  )
  await client.query(
    `WITH grouped AS (
       SELECT kind, path, count(*) AS views
       FROM byline_analytics_event
       WHERE occurred_at >= $2 AND occurred_at < $3
       GROUP BY kind, path
     ), ranked AS (
       SELECT kind, path,
         row_number() OVER (PARTITION BY kind ORDER BY views DESC, path ASC) AS rank
       FROM grouped
     )
     INSERT INTO byline_analytics_daily_path (day, kind, path, views, visitors)
     SELECT $1::date, event.kind, '__other__', count(*), count(DISTINCT event.visitor_hash)
     FROM byline_analytics_event event
     JOIN ranked ON ranked.kind = event.kind AND ranked.path = event.path
     WHERE event.occurred_at >= $2 AND event.occurred_at < $3 AND ranked.rank > $4
     GROUP BY event.kind`,
    [day, from, to, cap]
  )
}

async function insertSiteRollup(
  client: PoolClient,
  day: string,
  from: Date,
  to: Date
): Promise<void> {
  await client.query(
    `INSERT INTO byline_analytics_daily_site (day, views, visitors, downloads)
     SELECT $1::date,
       count(*) FILTER (WHERE kind = 'page'),
       count(DISTINCT visitor_hash) FILTER (WHERE kind = 'page'),
       count(*) FILTER (WHERE kind = 'download')
     FROM byline_analytics_event
     WHERE occurred_at >= $2 AND occurred_at < $3`,
    [day, from, to]
  )
}

async function insertReferrerRollups(
  client: PoolClient,
  day: string,
  from: Date,
  to: Date,
  cap: number
): Promise<void> {
  await client.query(
    `WITH grouped AS (
       SELECT referrer_host, count(*) AS views, count(DISTINCT visitor_hash) AS visitors
       FROM byline_analytics_event
       WHERE occurred_at >= $2 AND occurred_at < $3
         AND kind = 'page' AND referrer_host IS NOT NULL
       GROUP BY referrer_host
     ), ranked AS (
       SELECT *, row_number() OVER (ORDER BY views DESC, referrer_host ASC) AS rank
       FROM grouped
     )
     INSERT INTO byline_analytics_daily_referrer (day, referrer_host, views, visitors)
     SELECT $1::date, referrer_host, views, visitors FROM ranked WHERE rank <= $4`,
    [day, from, to, cap]
  )
  await client.query(
    `WITH grouped AS (
       SELECT referrer_host, count(*) AS views
       FROM byline_analytics_event
       WHERE occurred_at >= $2 AND occurred_at < $3
         AND kind = 'page' AND referrer_host IS NOT NULL
       GROUP BY referrer_host
     ), ranked AS (
       SELECT referrer_host, row_number() OVER (ORDER BY views DESC, referrer_host ASC) AS rank
       FROM grouped
     )
     INSERT INTO byline_analytics_daily_referrer (day, referrer_host, views, visitors)
     SELECT $1::date, '__other__', count(*), count(DISTINCT event.visitor_hash)
     FROM byline_analytics_event event
     JOIN ranked ON ranked.referrer_host = event.referrer_host
     WHERE event.occurred_at >= $2 AND event.occurred_at < $3
       AND event.kind = 'page' AND ranked.rank > $4
     HAVING count(*) > 0`,
    [day, from, to, cap]
  )
}

async function insertCountryRollups(
  client: PoolClient,
  day: string,
  from: Date,
  to: Date
): Promise<void> {
  await client.query(
    `INSERT INTO byline_analytics_daily_country (day, country, views, visitors)
     SELECT $1::date, country, count(*), count(DISTINCT visitor_hash)
     FROM byline_analytics_event
     WHERE occurred_at >= $2 AND occurred_at < $3
       AND kind = 'page' AND country IS NOT NULL
     GROUP BY country`,
    [day, from, to]
  )
}

const summarySql = `WITH state AS (
  SELECT last_complete_day FROM byline_analytics_rollup_state WHERE singleton = 1
), days AS (
  SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day
), rolled AS (
  SELECT site.day, site.views, site.visitors, site.downloads
  FROM byline_analytics_daily_site site, state
  WHERE site.day BETWEEN $1::date AND $2::date AND site.day <= state.last_complete_day
), raw AS (
  SELECT (event.occurred_at AT TIME ZONE 'UTC')::date AS day,
    count(*) FILTER (WHERE event.kind = 'page') AS views,
    count(DISTINCT event.visitor_hash) FILTER (WHERE event.kind = 'page') AS visitors,
    count(*) FILTER (WHERE event.kind = 'download') AS downloads
  FROM byline_analytics_event event
  LEFT JOIN state ON true
  WHERE event.occurred_at >= ($1::date::timestamp AT TIME ZONE 'UTC')
    AND event.occurred_at < (($2::date + 1)::timestamp AT TIME ZONE 'UTC')
    AND (state.last_complete_day IS NULL OR
      (event.occurred_at AT TIME ZONE 'UTC')::date > state.last_complete_day)
  GROUP BY (event.occurred_at AT TIME ZONE 'UTC')::date
)
SELECT days.day::text AS day,
  coalesce(rolled.views, raw.views, 0) AS views,
  coalesce(rolled.visitors, raw.visitors, 0) AS visitors,
  coalesce(rolled.downloads, raw.downloads, 0) AS downloads
FROM days
LEFT JOIN rolled USING (day)
LEFT JOIN raw USING (day)
ORDER BY days.day`

const topPathsSql = `WITH state AS (
  SELECT last_complete_day FROM byline_analytics_rollup_state WHERE singleton = 1
), per_day AS (
  SELECT path.day, path.path, path.views, path.visitors
  FROM byline_analytics_daily_path path, state
  WHERE path.day BETWEEN $1::date AND $2::date
    AND path.day <= state.last_complete_day AND path.kind = $3
  UNION ALL
  SELECT (event.occurred_at AT TIME ZONE 'UTC')::date, event.path,
    count(*), count(DISTINCT event.visitor_hash)
  FROM byline_analytics_event event
  LEFT JOIN state ON true
  WHERE event.occurred_at >= ($1::date::timestamp AT TIME ZONE 'UTC')
    AND event.occurred_at < (($2::date + 1)::timestamp AT TIME ZONE 'UTC')
    AND event.kind = $3
    AND (state.last_complete_day IS NULL OR
      (event.occurred_at AT TIME ZONE 'UTC')::date > state.last_complete_day)
  GROUP BY (event.occurred_at AT TIME ZONE 'UTC')::date, event.path
)
SELECT path, sum(views) AS views, sum(visitors) AS visitors,
  count(*) OVER () AS total
FROM per_day GROUP BY path ORDER BY views DESC, path ASC LIMIT $4`

const referrersSql = `WITH state AS (
  SELECT last_complete_day FROM byline_analytics_rollup_state WHERE singleton = 1
), per_day AS (
  SELECT ref.day, ref.referrer_host, ref.views, ref.visitors
  FROM byline_analytics_daily_referrer ref, state
  WHERE ref.day BETWEEN $1::date AND $2::date AND ref.day <= state.last_complete_day
  UNION ALL
  SELECT (event.occurred_at AT TIME ZONE 'UTC')::date, event.referrer_host,
    count(*), count(DISTINCT event.visitor_hash)
  FROM byline_analytics_event event
  LEFT JOIN state ON true
  WHERE event.occurred_at >= ($1::date::timestamp AT TIME ZONE 'UTC')
    AND event.occurred_at < (($2::date + 1)::timestamp AT TIME ZONE 'UTC')
    AND event.kind = 'page' AND event.referrer_host IS NOT NULL
    AND (state.last_complete_day IS NULL OR
      (event.occurred_at AT TIME ZONE 'UTC')::date > state.last_complete_day)
  GROUP BY (event.occurred_at AT TIME ZONE 'UTC')::date, event.referrer_host
)
SELECT referrer_host, sum(views) AS views, sum(visitors) AS visitors,
  count(*) OVER () AS total
FROM per_day GROUP BY referrer_host ORDER BY views DESC, referrer_host ASC LIMIT $3`

const countriesSql = `WITH state AS (
  SELECT last_complete_day FROM byline_analytics_rollup_state WHERE singleton = 1
), per_day AS (
  SELECT country.day, country.country, country.views, country.visitors
  FROM byline_analytics_daily_country country, state
  WHERE country.day BETWEEN $1::date AND $2::date AND country.day <= state.last_complete_day
  UNION ALL
  SELECT (event.occurred_at AT TIME ZONE 'UTC')::date, event.country,
    count(*), count(DISTINCT event.visitor_hash)
  FROM byline_analytics_event event
  LEFT JOIN state ON true
  WHERE event.occurred_at >= ($1::date::timestamp AT TIME ZONE 'UTC')
    AND event.occurred_at < (($2::date + 1)::timestamp AT TIME ZONE 'UTC')
    AND event.kind = 'page' AND event.country IS NOT NULL
    AND (state.last_complete_day IS NULL OR
      (event.occurred_at AT TIME ZONE 'UTC')::date > state.last_complete_day)
  GROUP BY (event.occurred_at AT TIME ZONE 'UTC')::date, event.country
)
SELECT country, sum(views) AS views, sum(visitors) AS visitors
FROM per_day GROUP BY country ORDER BY views DESC, country ASC`

function count(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(
      `[analytics-postgres] count is outside JavaScript's safe integer range: ${value}`
    )
  }
  return parsed
}
