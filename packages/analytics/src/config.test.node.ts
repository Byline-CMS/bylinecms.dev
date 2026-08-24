/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import {
  ANALYTICS_DASHBOARD_PERIODS,
  ANALYTICS_LONGEST_DASHBOARD_PERIOD_DAYS,
  resolveAnalyticsConfig,
} from './config.js'

describe('resolveAnalyticsConfig', () => {
  it('normalizes hosts and supplies bounded defaults', () => {
    const config = resolveAnalyticsConfig({ publicDomains: ['HTTPS://Example.COM:443'] })
    expect([...config.publicDomains]).toEqual(['example.com'])
    expect(config.pathCardinalityCap).toBe(1_000)
    expect(config.referrerCardinalityCap).toBe(1_000)
    expect(config.pathRetentionDays).toBeNull()
    expect(config.referrerRetentionDays).toBeNull()
  })

  it('rejects a cap below the dashboard limit and retention below its longest period', () => {
    expect(() =>
      resolveAnalyticsConfig({ publicDomains: ['example.com'], pathCardinalityCap: 19 })
    ).toThrow(/at least 20/u)
    expect(() =>
      resolveAnalyticsConfig({ publicDomains: ['example.com'], pathRetentionDays: 89 })
    ).toThrow(/at least 90 days/u)
  })

  it('derives the retention floor from the supported dashboard periods', () => {
    expect(ANALYTICS_LONGEST_DASHBOARD_PERIOD_DAYS).toBe(Math.max(...ANALYTICS_DASHBOARD_PERIODS))
  })
})
