/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { randomBytes } from 'node:crypto'

import type { BylineLogger } from '@byline/core'

import {
  ANALYTICS_DEDUPE_WINDOW_MS,
  ANALYTICS_MAX_BODY_BYTES,
  ANALYTICS_MAX_TOP_LIMIT,
  type AnalyticsConfig,
  type ResolvedAnalyticsConfig,
  resolveAnalyticsConfig,
} from './config.js'
import { isCrawlerUserAgent } from './crawler-user-agents.js'
import { addAnalyticsDays, analyticsDay, assertAnalyticsDay, compareAnalyticsDays } from './date.js'
import { AnalyticsDedupeCache } from './dedupe.js'
import { AnalyticsMetrics } from './metrics.js'
import {
  isIgnoredAnalyticsPath,
  normalizeAnalyticsPath,
  normalizeCountry,
  normalizeReferrerHost,
  parseBeaconPayload,
  requestHost,
} from './normalize.js'
import { hashAnalyticsVisitor } from './visitor.js'
import type {
  AnalyticsCountryTotal,
  AnalyticsDateRange,
  AnalyticsIngestRequest,
  AnalyticsIngestResult,
  AnalyticsLimitQuery,
  AnalyticsPathTotal,
  AnalyticsRankedTotals,
  AnalyticsReferrerTotal,
  AnalyticsReportCoverage,
  AnalyticsStore,
  AnalyticsSummary,
  AnalyticsTopQuery,
} from './types.js'

export interface CreateAnalyticsOptions extends AnalyticsConfig {
  store: AnalyticsStore
  /** Test seam; production uses the process clock. */
  now?: () => Date
  /** Test seam; production uses cryptographically random 32-byte salts. */
  createSalt?: () => Uint8Array
}

export class Analytics {
  readonly config: ResolvedAnalyticsConfig
  readonly metrics: AnalyticsMetrics
  readonly #store: AnalyticsStore
  readonly #dedupe: AnalyticsDedupeCache
  readonly #now: () => Date
  readonly #createSalt: () => Uint8Array
  #dailySalt: { day: string; value: Promise<Uint8Array> } | undefined

  constructor(options: CreateAnalyticsOptions) {
    this.#store = options.store
    this.config = resolveAnalyticsConfig(options)
    this.#now = options.now ?? (() => new Date())
    this.#createSalt = options.createSalt ?? (() => randomBytes(32))
    this.#dedupe = new AnalyticsDedupeCache(
      this.config.dedupeMaxEntries,
      ANALYTICS_DEDUPE_WINDOW_MS
    )
    this.metrics = new AnalyticsMetrics(this.#now(), this.config.logger)
  }

  async ingest(request: AnalyticsIngestRequest): Promise<AnalyticsIngestResult> {
    const now = this.#now()
    const finish = (result: AnalyticsIngestResult): AnalyticsIngestResult => {
      this.metrics.record(result, now)
      return result
    }

    if (request.method.toUpperCase() !== 'POST') {
      return finish({ status: 400, accepted: false, reason: 'method' })
    }

    const body = decodeBody(request.body)
    if (body == null || Buffer.byteLength(body, 'utf8') > ANALYTICS_MAX_BODY_BYTES) {
      return finish({ status: 400, accepted: false, reason: 'body-size' })
    }
    const payload = parseBeaconPayload(body)
    if (payload == null) return finish({ status: 400, accepted: false, reason: 'malformed' })

    const host = requestHost(request.origin, request.referer)
    if (host == null || !this.config.publicDomains.has(host)) {
      return finish({ status: 204, accepted: false, reason: 'origin' })
    }

    const path = normalizeAnalyticsPath(payload.path)
    if (path == null) return finish({ status: 400, accepted: false, reason: 'malformed' })
    if (isIgnoredAnalyticsPath(path, this.config.ignoredPathPrefixes)) {
      return finish({ status: 204, accepted: false, reason: 'admin-path' })
    }

    const userAgent = request.userAgent?.trim()
    if (!userAgent || isCrawlerUserAgent(userAgent)) {
      return finish({ status: 204, accepted: false, reason: 'bot' })
    }
    if (isPrefetch(request.secPurpose, request.xPurpose)) {
      return finish({ status: 204, accepted: false, reason: 'prefetch' })
    }

    const clientIp = request.clientIp?.trim()
    if (!clientIp) {
      return finish({ status: 204, accepted: false, reason: 'client-ip' })
    }

    const day = analyticsDay(now)
    const salt = await this.getDailySalt(day)
    const visitorHash = hashAnalyticsVisitor(salt, clientIp, userAgent)
    const dedupeKey = `${visitorHash}\u0000${payload.kind}\u0000${path}`
    if (this.#dedupe.check(dedupeKey, now.valueOf())) {
      return finish({ status: 204, accepted: false, reason: 'dedupe' })
    }

    try {
      await this.#store.insertEvent({
        occurredAt: now,
        kind: payload.kind,
        source: 'beacon',
        path,
        visitorHash,
        referrerHost: normalizeReferrerHost(payload.ref, this.config.publicDomains),
        country: normalizeCountry(request.country),
      })
    } catch (error) {
      this.#dedupe.forget(dedupeKey)
      throw error
    }
    return finish({ status: 202, accepted: true })
  }

  async getSummary(range: AnalyticsDateRange): Promise<AnalyticsSummary> {
    const validated = validateRange(range)
    const timeseries = await this.#store.getSummary(validated)
    return {
      views: timeseries.reduce((total, row) => total + row.views, 0),
      visitors: timeseries.reduce((total, row) => total + row.visitors, 0),
      downloads: timeseries.reduce((total, row) => total + row.downloads, 0),
      timeseries,
    }
  }

  getTopPaths(query: AnalyticsTopQuery): Promise<AnalyticsRankedTotals<AnalyticsPathTotal>> {
    return this.#store.getTopPaths({
      ...validateRange(query),
      kind: query.kind,
      limit: validateLimit(query.limit),
    })
  }

  getReferrers(query: AnalyticsLimitQuery): Promise<AnalyticsRankedTotals<AnalyticsReferrerTotal>> {
    return this.#store.getReferrers({
      ...validateRange(query),
      limit: validateLimit(query.limit),
    })
  }

  getCountries(range: AnalyticsDateRange): Promise<AnalyticsCountryTotal[]> {
    return this.#store.getCountries(validateRange(range))
  }

  /** Describe the independently retained dimensions available to reporting. */
  async getReportCoverage(): Promise<AnalyticsReportCoverage> {
    const summaryFrom = await this.#store.getEarliestReportDay()
    if (summaryFrom == null) {
      return { summaryFrom: null, pathsFrom: null, referrersFrom: null }
    }

    const today = analyticsDay(this.#now())
    return {
      summaryFrom,
      pathsFrom: coverageStart(summaryFrom, today, this.config.pathRetentionDays),
      referrersFrom: coverageStart(summaryFrom, today, this.config.referrerRetentionDays),
    }
  }

  /** Maintenance tooling may delete a bounded slice, then call `rebuildDay` per affected day. */
  deleteEvents(options: Parameters<AnalyticsStore['deleteEvents']>[0]): Promise<number> {
    if (options.to <= options.from) throw new Error('Analytics deletion `to` must be after `from`')
    if (options.visitorHash != null && !/^[a-f0-9]{64}$/u.test(options.visitorHash)) {
      throw new Error('Analytics visitorHash must be 64 lowercase hexadecimal characters')
    }
    return this.#store.deleteEvents(options)
  }

  rebuildDay(day: string): Promise<void> {
    return this.#store.rebuildDay({
      day: assertAnalyticsDay(day),
      pathCardinalityCap: this.config.pathCardinalityCap,
      referrerCardinalityCap: this.config.referrerCardinalityCap,
      advanceCursor: false,
    })
  }

  /** Internal orchestration seam used by the recurring task. */
  get store(): AnalyticsStore {
    return this.#store
  }

  /** Bind the composed application logger after host bootstrap has initialized it. */
  setLogger(logger: BylineLogger): void {
    this.metrics.setLogger(logger)
  }

  private getDailySalt(day: string): Promise<Uint8Array> {
    if (this.#dailySalt?.day === day) return this.#dailySalt.value

    const candidate = this.#createSalt()
    if (candidate.byteLength !== 32) {
      throw new Error('Analytics salt factories must return 32 bytes')
    }

    const value = this.#store.getOrCreateDailySalt(day, candidate).then((salt) => {
      if (salt.byteLength !== 32) {
        throw new Error('Analytics stores must return a 32-byte daily salt')
      }
      return salt
    })
    const entry = { day, value }
    this.#dailySalt = entry
    void value.catch(() => {
      if (this.#dailySalt === entry) this.#dailySalt = undefined
    })
    return value
  }
}

export function createAnalytics(options: CreateAnalyticsOptions): Analytics {
  return new Analytics(options)
}

function decodeBody(body: string | Uint8Array): string | null {
  if (typeof body === 'string') return body
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    return null
  }
}

function isPrefetch(secPurpose: string | null | undefined, xPurpose: string | null | undefined) {
  return (
    secPurpose
      ?.toLowerCase()
      .split(/[,;\s]+/u)
      .includes('prefetch') === true ||
    xPurpose
      ?.toLowerCase()
      .split(/[,;\s]+/u)
      .includes('preview') === true
  )
}

function validateRange(range: AnalyticsDateRange): AnalyticsDateRange {
  const from = assertAnalyticsDay(range.from, 'analytics range.from')
  const to = assertAnalyticsDay(range.to, 'analytics range.to')
  if (compareAnalyticsDays(from, to) > 0) {
    throw new Error('analytics range.from must not be after range.to')
  }
  return { from, to }
}

function validateLimit(limit = 20): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > ANALYTICS_MAX_TOP_LIMIT) {
    throw new Error(`analytics limit must be an integer between 1 and ${ANALYTICS_MAX_TOP_LIMIT}`)
  }
  return limit
}

function coverageStart(summaryFrom: string, today: string, retentionDays: number | null): string {
  if (retentionDays == null) return summaryFrom
  const retainedFrom = addAnalyticsDays(today, -retentionDays)
  return compareAnalyticsDays(summaryFrom, retainedFrom) >= 0 ? summaryFrom : retainedFrom
}
