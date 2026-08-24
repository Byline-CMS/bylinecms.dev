/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

export {
  Analytics,
  type CreateAnalyticsOptions,
  createAnalytics,
} from './analytics.js'
export {
  ANALYTICS_DEDUPE_WINDOW_MS,
  ANALYTICS_DEFAULT_CARDINALITY_CAP,
  ANALYTICS_EVENT_RETENTION_DAYS,
  ANALYTICS_FIXED_DASHBOARD_PERIODS,
  ANALYTICS_LONGEST_DASHBOARD_PERIOD_DAYS,
  ANALYTICS_MAX_BODY_BYTES,
  ANALYTICS_MAX_PATH_LENGTH,
  ANALYTICS_MAX_TOP_LIMIT,
  ANALYTICS_MIN_CARDINALITY_CAP,
  ANALYTICS_OVERFLOW_KEY,
  type AnalyticsConfig,
  type ResolvedAnalyticsConfig,
  resolveAnalyticsConfig,
} from './config.js'
export {
  addAnalyticsDays,
  analyticsDay,
  assertAnalyticsDay,
  compareAnalyticsDays,
  startOfAnalyticsDay,
} from './date.js'
export {
  type AnalyticsMaintenanceOptions,
  type AnalyticsMaintenanceResult,
  type DefineAnalyticsRollupTaskOptions,
  defineAnalyticsRollupTask,
  runAnalyticsMaintenance,
} from './maintenance.js'
export {
  isIgnoredAnalyticsPath,
  normalizeAnalyticsPath,
  normalizeCountry,
  normalizeReferrerHost,
  parseBeaconPayload,
  requestHost,
} from './normalize.js'
export {
  type AnalyticsPrivacyStatement,
  type AnalyticsPrivacyStatementOptions,
  createAnalyticsPrivacyStatement,
} from './privacy-statement.js'
export {
  getAnalytics,
  isAnalyticsRegistered,
  registerAnalytics,
  tryGetAnalytics,
} from './runtime.js'
export { canonicalVisitorIdentity, hashAnalyticsVisitor } from './visitor.js'
export type {
  AnalyticsCountryTotal,
  AnalyticsDateRange,
  AnalyticsDay,
  AnalyticsDeleteEventsOptions,
  AnalyticsDropReason,
  AnalyticsEvent,
  AnalyticsEventKind,
  AnalyticsEventSource,
  AnalyticsIngestRequest,
  AnalyticsIngestResult,
  AnalyticsLimitQuery,
  AnalyticsMetricsSnapshot,
  AnalyticsPathTotal,
  AnalyticsPruneOptions,
  AnalyticsPruneResult,
  AnalyticsRankedTotals,
  AnalyticsReferrerTotal,
  AnalyticsRejectReason,
  AnalyticsReportCoverage,
  AnalyticsRollupDayOptions,
  AnalyticsStore,
  AnalyticsSummary,
  AnalyticsSummaryDay,
  AnalyticsTopQuery,
} from './types.js'
