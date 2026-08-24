/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { buildAnalyticsDashboardRange } from './analytics-range.js'

describe('buildAnalyticsDashboardRange', () => {
  it('builds inclusive UTC periods across month and year boundaries', () => {
    expect(buildAnalyticsDashboardRange(7, new Date('2027-01-03T23:59:59.999Z'))).toEqual({
      from: '2026-12-28',
      to: '2027-01-03',
    })
  })

  it('builds year-to-date from January 1 in UTC', () => {
    expect(buildAnalyticsDashboardRange('ytd', new Date('2027-06-03T23:59:59.999Z'))).toEqual({
      from: '2027-01-01',
      to: '2027-06-03',
    })
  })

  it('builds all-time from the earliest reportable day', () => {
    expect(
      buildAnalyticsDashboardRange('all', new Date('2027-06-03T23:59:59.999Z'), '2024-02-29')
    ).toEqual({ from: '2024-02-29', to: '2027-06-03' })
  })

  it('uses today for an empty all-time report', () => {
    expect(buildAnalyticsDashboardRange('all', new Date('2027-06-03T23:59:59.999Z'))).toEqual({
      from: '2027-06-03',
      to: '2027-06-03',
    })
  })

  it('rejects an invalid earliest report day before constructing a range', () => {
    expect(() =>
      buildAnalyticsDashboardRange('all', new Date('2027-06-03T23:59:59.999Z'), '2027-02-30')
    ).toThrow(/real UTC calendar day/u)
  })
})
