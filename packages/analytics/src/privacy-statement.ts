/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { ANALYTICS_EVENT_RETENTION_DAYS } from './config.js'

export interface AnalyticsPrivacyStatementOptions {
  /** Public name of the site or organization operating this installation. */
  operatorName: string
  /** Deployment-specific instructions for setting the browser-local exclusion flag. */
  exclusionInstructions: string
  /** Match the configured aggregate retention; `null` means indefinite. */
  pathRetentionDays?: number | null
  /** Match the configured aggregate retention; `null` means indefinite. */
  referrerRetentionDays?: number | null
  title?: string
}

export interface AnalyticsPrivacyStatement {
  title: string
  paragraphs: readonly string[]
  /** This reminder is intentionally separate from public-facing copy. */
  operatorNotice: string
}

/**
 * Build editable, plain-text privacy copy that stays aligned with the v1 data
 * model. Deployments must review and publish it as part of their own notice.
 */
export function createAnalyticsPrivacyStatement(
  options: AnalyticsPrivacyStatementOptions
): AnalyticsPrivacyStatement {
  const operatorName = requiredText(options.operatorName, 'operatorName')
  const exclusionInstructions = requiredText(options.exclusionInstructions, 'exclusionInstructions')
  const pathRetention = retentionText(options.pathRetentionDays)
  const referrerRetention = retentionText(options.referrerRetentionDays)

  return {
    title: options.title?.trim() || `${operatorName} analytics privacy`,
    paragraphs: [
      `${operatorName} uses first-party analytics to count page views, daily unique visitors, and download clicks. The analytics feature sets no cookies and does not create an identifier that follows a visitor across days.`,
      `For each event, the server uses the request IP address and browser user agent to derive a pseudonymous identifier under a random salt that changes every UTC day. The raw IP address is not stored or logged by the analytics feature.`,
      `Raw analytics events are retained for up to ${ANALYTICS_EVENT_RETENTION_DAYS} days. Daily site and country totals are retained indefinitely. Daily page totals are ${pathRetention}, and daily referrer totals are ${referrerRetention}. Daily aggregates contain no visitor identifier.`,
      `The analytics feature does not sell or share event data with third parties and does not use it for cross-context targeted advertising.`,
      exclusionInstructions,
    ],
    operatorNotice:
      'Template only, not legal advice. Review the final notice for the deployment and update it before changing collection, retention, sharing, or identification behavior.',
  }
}

function requiredText(value: string, label: string): string {
  const text = value.trim()
  if (text === '') throw new Error(`analytics privacy ${label} must not be blank`)
  return text
}

function retentionText(days: number | null | undefined): string {
  if (days == null) return 'retained indefinitely'
  if (!Number.isSafeInteger(days) || days < 1) {
    throw new Error('analytics privacy retention days must be positive integers or null')
  }
  return `retained for up to ${days} days`
}
