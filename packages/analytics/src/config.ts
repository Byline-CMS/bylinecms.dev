/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { BylineLogger } from '@byline/core'

// Browser-safe public subpath: @byline/analytics/config.
// Keep every runtime import in this module browser-compatible.
/**
 * Reserved `path` / `referrer_host` value holding each day's overflow beyond
 * the cardinality cap. Ingest normalization must never be able to produce it,
 * and both SQL drivers enforce that with a CHECK constraint.
 */
export const ANALYTICS_OVERFLOW_KEY = '__other__'

export const ANALYTICS_EVENT_RETENTION_DAYS = 90
export const ANALYTICS_DASHBOARD_PERIODS = [7, 30, 90] as const
export type AnalyticsDashboardPeriod = (typeof ANALYTICS_DASHBOARD_PERIODS)[number]
export const ANALYTICS_LONGEST_DASHBOARD_PERIOD_DAYS = Math.max(...ANALYTICS_DASHBOARD_PERIODS)
export const ANALYTICS_MIN_CARDINALITY_CAP = 20
export const ANALYTICS_DEFAULT_CARDINALITY_CAP = 1_000
export const ANALYTICS_MAX_TOP_LIMIT = 100
export const ANALYTICS_MAX_BODY_BYTES = 1_024
export const ANALYTICS_MAX_PATH_LENGTH = 512
export const ANALYTICS_DEDUPE_WINDOW_MS = 10_000

export interface AnalyticsConfig {
  /** Hosts accepted by the Origin/Referer filter, with optional development ports. */
  publicDomains: readonly string[]
  /** Admin/internal path prefixes silently discarded before storage. */
  ignoredPathPrefixes?: readonly string[]
  pathCardinalityCap?: number
  referrerCardinalityCap?: number
  /** `null` retains aggregate strings indefinitely. */
  pathRetentionDays?: number | null
  /** `null` retains aggregate strings indefinitely. */
  referrerRetentionDays?: number | null
  /** Per-instance replay cache bound. Defaults to 10,000 entries. */
  dedupeMaxEntries?: number
  logger?: BylineLogger
}

export interface ResolvedAnalyticsConfig {
  publicDomains: ReadonlySet<string>
  ignoredPathPrefixes: readonly string[]
  pathCardinalityCap: number
  referrerCardinalityCap: number
  pathRetentionDays: number | null
  referrerRetentionDays: number | null
  dedupeMaxEntries: number
  logger?: BylineLogger
}

export function isAnalyticsDashboardPeriod(value: number): value is AnalyticsDashboardPeriod {
  return ANALYTICS_DASHBOARD_PERIODS.some((period) => period === value)
}

export function resolveAnalyticsConfig(config: AnalyticsConfig): ResolvedAnalyticsConfig {
  if (config.publicDomains.length === 0) {
    throw new Error('analytics.publicDomains must contain at least one host')
  }

  const publicDomains = new Set(config.publicDomains.map(normalizeConfiguredHost))
  const ignoredPathPrefixes = (config.ignoredPathPrefixes ?? ['/_byline', '/api']).map(
    normalizeIgnoredPrefix
  )

  return {
    publicDomains,
    ignoredPathPrefixes: [...new Set(ignoredPathPrefixes)],
    pathCardinalityCap: validateCap(
      config.pathCardinalityCap ?? ANALYTICS_DEFAULT_CARDINALITY_CAP,
      'pathCardinalityCap'
    ),
    referrerCardinalityCap: validateCap(
      config.referrerCardinalityCap ?? ANALYTICS_DEFAULT_CARDINALITY_CAP,
      'referrerCardinalityCap'
    ),
    pathRetentionDays: validateRetention(config.pathRetentionDays, 'pathRetentionDays'),
    referrerRetentionDays: validateRetention(config.referrerRetentionDays, 'referrerRetentionDays'),
    dedupeMaxEntries: validatePositiveInteger(
      config.dedupeMaxEntries ?? 10_000,
      'dedupeMaxEntries'
    ),
    ...(config.logger == null ? {} : { logger: config.logger }),
  }
}

function normalizeConfiguredHost(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error('analytics.publicDomains cannot contain a blank host')
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('host must not include credentials, a path, a query, or a fragment')
    }
    return url.host.toLowerCase().replace(/\.$/, '')
  } catch (error) {
    throw new Error(`Invalid analytics public domain "${value}": ${(error as Error).message}`)
  }
}

function normalizeIgnoredPrefix(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith('/')) {
    throw new Error(`Analytics ignored path prefix "${value}" must start with /`)
  }
  return trimmed.length > 1 ? trimmed.replace(/\/+$/, '') : trimmed
}

function validateCap(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < ANALYTICS_MIN_CARDINALITY_CAP) {
    throw new Error(
      `analytics.${label} must be an integer at least ${ANALYTICS_MIN_CARDINALITY_CAP}`
    )
  }
  return value
}

function validateRetention(value: number | null | undefined, label: string): number | null {
  if (value == null) return null
  if (!Number.isSafeInteger(value) || value < ANALYTICS_LONGEST_DASHBOARD_PERIOD_DAYS) {
    throw new Error(
      `analytics.${label} must be null or an integer at least ` +
        `${ANALYTICS_LONGEST_DASHBOARD_PERIOD_DAYS} days (the longest dashboard period)`
    )
  }
  return value
}

function validatePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`analytics.${label} must be a positive integer`)
  }
  return value
}
