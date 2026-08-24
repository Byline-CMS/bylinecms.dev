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
})
