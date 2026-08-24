/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it, vi } from 'vitest'

import { createAnalytics } from './analytics.js'
import { runAnalyticsMaintenance } from './maintenance.js'
import type { AnalyticsStore } from './types.js'

describe('runAnalyticsMaintenance', () => {
  it('catches up complete days in bounded batches and prunes only after catch-up', async () => {
    const rebuildDay = vi.fn(async () => {})
    const prune = vi.fn(async () => ({
      events: 0,
      salts: 0,
      pathAggregates: 0,
      referrerAggregates: 0,
    }))
    const store = {
      getRollupCursor: async () => '2026-08-18',
      getEarliestEventDay: async () => null,
      getEarliestReportDay: async () => null,
      rebuildDay,
      prune,
    } as unknown as AnalyticsStore
    const analytics = createAnalytics({ store, publicDomains: ['example.com'] })
    const heartbeat = vi.fn(async () => {})

    const first = await runAnalyticsMaintenance(
      { analytics, maxDaysPerRun: 2, now: () => new Date('2026-08-23T12:00:00.000Z') },
      { heartbeat }
    )
    expect(first).toEqual({
      processedDays: ['2026-08-19', '2026-08-20'],
      workRemaining: true,
    })
    expect(prune).not.toHaveBeenCalled()

    store.getRollupCursor = async () => '2026-08-20'
    const second = await runAnalyticsMaintenance(
      { analytics, maxDaysPerRun: 5, now: () => new Date('2026-08-23T12:00:00.000Z') },
      { heartbeat }
    )
    expect(second).toEqual({ processedDays: ['2026-08-21', '2026-08-22'], workRemaining: false })
    expect(prune).toHaveBeenCalledWith({
      eventsBefore: new Date('2026-05-25T00:00:00.000Z'),
      saltsBefore: '2026-08-22',
      pathAggregatesBefore: null,
      referrerAggregatesBefore: null,
    })
    expect(heartbeat).toHaveBeenCalledTimes(4)
  })
})
