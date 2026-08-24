/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/** A UTC calendar day in `YYYY-MM-DD` form. */
export type AnalyticsDay = string

export type AnalyticsEventKind = 'page' | 'download'
export type AnalyticsEventSource = 'beacon' | 'redirect' | 'cdnlog'

/** The only event shape a storage driver receives. Raw IP is deliberately absent. */
export interface AnalyticsEvent {
  occurredAt: Date
  kind: AnalyticsEventKind
  source: AnalyticsEventSource
  path: string
  visitorHash: string
  referrerHost: string | null
  country: string | null
}

export interface AnalyticsSummaryDay {
  day: AnalyticsDay
  views: number
  visitors: number
  downloads: number
}

export interface AnalyticsSummary {
  views: number
  visitors: number
  downloads: number
  /** Visitor totals are sums of daily uniques; hashes never link UTC days. */
  timeseries: AnalyticsSummaryDay[]
}

export interface AnalyticsPathTotal {
  path: string
  views: number
  /** Sum of per-day unique visitors, not a cross-day distinct count. */
  visitors: number
}

export interface AnalyticsReferrerTotal {
  referrerHost: string
  views: number
  /** Sum of per-day unique visitors, not a cross-day distinct count. */
  visitors: number
}

export interface AnalyticsCountryTotal {
  country: string
  views: number
  /** Sum of per-day unique visitors, not a cross-day distinct count. */
  visitors: number
}

/**
 * A ranked list plus the size of the set it was drawn from.
 *
 * `total` is the number of distinct keys in the period *before* the top-N limit,
 * so the interface can say "top 20 of 143" instead of presenting a truncated
 * list as though it were the whole one. It is bounded by the rollup's
 * cardinality cap for days already processed: paths past that cap were folded
 * into the reserved overflow row, which counts as one key, not many.
 */
export interface AnalyticsRankedTotals<Row> {
  rows: Row[]
  total: number
}

export interface AnalyticsDateRange {
  from: AnalyticsDay
  to: AnalyticsDay
}

/**
 * Earliest UTC days for which each report dimension is complete under the
 * current retention configuration. Headline totals and countries are retained
 * indefinitely. Paths (including downloads) and referrers may begin later when
 * their configured aggregate retention is finite.
 */
export interface AnalyticsReportCoverage {
  summaryFrom: AnalyticsDay | null
  pathsFrom: AnalyticsDay | null
  referrersFrom: AnalyticsDay | null
}

export interface AnalyticsTopQuery extends AnalyticsDateRange {
  kind: AnalyticsEventKind
  limit?: number
}

export interface AnalyticsLimitQuery extends AnalyticsDateRange {
  limit?: number
}

export interface AnalyticsRollupDayOptions {
  day: AnalyticsDay
  pathCardinalityCap: number
  referrerCardinalityCap: number
  /** Manual repair rebuilds a day without moving the sequential cursor. */
  advanceCursor: boolean
}

export interface AnalyticsPruneOptions {
  eventsBefore: Date
  saltsBefore: AnalyticsDay
  pathAggregatesBefore: AnalyticsDay | null
  referrerAggregatesBefore: AnalyticsDay | null
}

export interface AnalyticsPruneResult {
  events: number
  salts: number
  pathAggregates: number
  referrerAggregates: number
}

export interface AnalyticsDeleteEventsOptions {
  from: Date
  to: Date
  visitorHash?: string
}

/**
 * Database-neutral storage contract. SQL drivers own schemas, migrations, and
 * transaction boundaries; analytics owns behavior and orchestration.
 */
export interface AnalyticsStore {
  /** Insert the candidate salt if absent, then return the row that won. */
  getOrCreateDailySalt(day: AnalyticsDay, candidate: Uint8Array): Promise<Uint8Array>
  insertEvent(event: AnalyticsEvent): Promise<void>

  getRollupCursor(): Promise<AnalyticsDay | null>
  getEarliestEventDay(): Promise<AnalyticsDay | null>
  /** Earliest day present in either retained headline aggregates or raw events. */
  getEarliestReportDay(): Promise<AnalyticsDay | null>
  rebuildDay(options: AnalyticsRollupDayOptions): Promise<void>
  prune(options: AnalyticsPruneOptions): Promise<AnalyticsPruneResult>

  getSummary(range: AnalyticsDateRange): Promise<AnalyticsSummaryDay[]>
  getTopPaths(
    query: Required<AnalyticsTopQuery>
  ): Promise<AnalyticsRankedTotals<AnalyticsPathTotal>>
  getReferrers(
    query: Required<AnalyticsLimitQuery>
  ): Promise<AnalyticsRankedTotals<AnalyticsReferrerTotal>>
  getCountries(range: AnalyticsDateRange): Promise<AnalyticsCountryTotal[]>

  deleteEvents(options: AnalyticsDeleteEventsOptions): Promise<number>
}

export type AnalyticsDropReason =
  | 'origin'
  | 'admin-path'
  | 'bot'
  | 'prefetch'
  | 'client-ip'
  | 'dedupe'

export type AnalyticsRejectReason = 'method' | 'body-size' | 'malformed'

export type AnalyticsIngestResult =
  | { status: 202; accepted: true }
  | { status: 204; accepted: false; reason: AnalyticsDropReason }
  | { status: 400; accepted: false; reason: AnalyticsRejectReason }

/**
 * Host-normalized request data. The trusted bridge supplies `clientIp` and
 * `country`; analytics never reads forwarding headers and never persists or
 * logs `clientIp`.
 */
export interface AnalyticsIngestRequest {
  method: string
  body: string | Uint8Array
  origin?: string | null
  referer?: string | null
  userAgent?: string | null
  secPurpose?: string | null
  xPurpose?: string | null
  clientIp?: string | null
  country?: string | null
}

export interface AnalyticsMetricsSnapshot {
  day: AnalyticsDay
  accepted: number
  drops: Record<AnalyticsDropReason | AnalyticsRejectReason, number>
}
