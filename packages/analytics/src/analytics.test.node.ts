/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { createAnalytics } from './analytics.js'
import type {
  AnalyticsDateRange,
  AnalyticsEvent,
  AnalyticsLimitQuery,
  AnalyticsPruneOptions,
  AnalyticsPruneResult,
  AnalyticsRollupDayOptions,
  AnalyticsStore,
  AnalyticsTopQuery,
} from './types.js'

const TEST_BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

describe('analytics ingest', () => {
  it('accepts an exact beacon payload and stores only normalized, pseudonymous data', async () => {
    const store = new MemoryStore()
    const analytics = fixtureAnalytics(store)

    await expect(
      analytics.ingest({
        method: 'POST',
        body: JSON.stringify({
          v: 1,
          kind: 'page',
          path: '/news//today?preview=1#lead',
          ref: 'https://search.example/results',
        }),
        origin: 'https://example.com',
        userAgent: TEST_BROWSER_USER_AGENT,
        clientIp: '203.0.113.5',
        country: 'th',
      })
    ).resolves.toEqual({ status: 202, accepted: true })

    expect(store.events).toHaveLength(1)
    expect(store.events[0]).toMatchObject({
      path: '/news/today',
      kind: 'page',
      source: 'beacon',
      referrerHost: 'search.example',
      country: 'TH',
    })
    expect(store.events[0]?.visitorHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(JSON.stringify(store.events[0])).not.toContain('203.0.113.5')
  })

  it('never stores the reserved aggregate sentinel as a referrer', async () => {
    const store = new MemoryStore()
    const analytics = fixtureAnalytics(store)

    await expect(
      analytics.ingest({
        ...ingestRequest(),
        body: payload({ ref: 'https://__OTHER__./crafted' }),
      })
    ).resolves.toEqual({ status: 202, accepted: true })

    expect(store.events[0]?.referrerHost).toBeNull()
  })

  it('memoizes the daily salt and rotates it at the next UTC day', async () => {
    const store = new MemoryStore()
    let now = new Date('2026-08-23T23:59:59.999Z')
    const analytics = createAnalytics({
      store,
      publicDomains: ['example.com'],
      now: () => now,
      createSalt: () => new Uint8Array(32).fill(7),
    })

    await analytics.ingest(ingestRequest())
    await analytics.ingest({ ...ingestRequest(), body: payload({ path: '/another' }) })
    expect(store.saltCalls).toBe(1)

    now = new Date('2026-08-24T00:00:00.000Z')
    await analytics.ingest({ ...ingestRequest(), body: payload({ path: '/next-day' }) })
    expect(store.saltCalls).toBe(2)
  })

  it('silently separates origin, admin, bot, prefetch, and replay drops', async () => {
    const store = new MemoryStore()
    const analytics = fixtureAnalytics(store)
    const request = ingestRequest()

    await expect(
      analytics.ingest({ ...request, origin: 'https://wrong.example' })
    ).resolves.toEqual({ status: 204, accepted: false, reason: 'origin' })
    await expect(
      analytics.ingest({ ...request, body: payload({ path: '/_byline/users' }) })
    ).resolves.toEqual({ status: 204, accepted: false, reason: 'admin-path' })
    await expect(analytics.ingest({ ...request, userAgent: 'Googlebot/2.1' })).resolves.toEqual({
      status: 204,
      accepted: false,
      reason: 'bot',
    })
    await expect(analytics.ingest({ ...request, secPurpose: 'prefetch' })).resolves.toEqual({
      status: 204,
      accepted: false,
      reason: 'prefetch',
    })
    await expect(analytics.ingest({ ...request, clientIp: null })).resolves.toEqual({
      status: 204,
      accepted: false,
      reason: 'client-ip',
    })
    await expect(analytics.ingest(request)).resolves.toEqual({ status: 202, accepted: true })
    await expect(analytics.ingest(request)).resolves.toEqual({
      status: 204,
      accepted: false,
      reason: 'dedupe',
    })
    expect(store.events).toHaveLength(1)
  })

  it('rejects oversized, malformed, and extended payloads before storage', async () => {
    const store = new MemoryStore()
    const analytics = fixtureAnalytics(store)

    await expect(
      analytics.ingest({ ...ingestRequest(), body: 'x'.repeat(1_025) })
    ).resolves.toEqual({ status: 400, accepted: false, reason: 'body-size' })
    await expect(analytics.ingest({ ...ingestRequest(), body: '{' })).resolves.toEqual({
      status: 400,
      accepted: false,
      reason: 'malformed',
    })
    await expect(
      analytics.ingest({
        ...ingestRequest(),
        body: JSON.stringify({
          v: 1,
          kind: 'page',
          path: '/',
          ref: '',
          siteId: 'forged',
        }),
      })
    ).resolves.toEqual({ status: 400, accepted: false, reason: 'malformed' })
    expect(store.saltCalls).toBe(0)
    expect(store.events).toEqual([])
  })

  it('does not poison replay dedupe when persistence fails', async () => {
    const store = new MemoryStore()
    store.failNextInsert = true
    const analytics = fixtureAnalytics(store)

    await expect(analytics.ingest(ingestRequest())).rejects.toThrow('insert failed')
    await expect(analytics.ingest(ingestRequest())).resolves.toEqual({
      status: 202,
      accepted: true,
    })
  })
})

describe('analytics reporting coverage', () => {
  it('reports independent finite-retention boundaries without shortening headline history', async () => {
    const store = new MemoryStore()
    store.earliestReportDay = '2025-01-01'
    const analytics = createAnalytics({
      store,
      publicDomains: ['example.com'],
      pathRetentionDays: 90,
      referrerRetentionDays: 180,
      now: () => new Date('2026-08-24T12:00:00.000Z'),
    })

    await expect(analytics.getReportCoverage()).resolves.toEqual({
      summaryFrom: '2025-01-01',
      pathsFrom: '2026-05-26',
      referrersFrom: '2026-02-25',
    })
  })

  it('reports no coverage before any raw or aggregate day exists', async () => {
    await expect(fixtureAnalytics(new MemoryStore()).getReportCoverage()).resolves.toEqual({
      summaryFrom: null,
      pathsFrom: null,
      referrersFrom: null,
    })
  })
})

function fixtureAnalytics(store: MemoryStore) {
  return createAnalytics({
    store,
    publicDomains: ['example.com'],
    now: () => new Date('2026-08-23T08:00:00.000Z'),
    createSalt: () => new Uint8Array(32).fill(7),
  })
}

function payload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ v: 1, kind: 'page', path: '/news', ref: '', ...overrides })
}

function ingestRequest() {
  return {
    method: 'POST',
    body: payload(),
    origin: 'https://example.com',
    userAgent: TEST_BROWSER_USER_AGENT,
    clientIp: '203.0.113.5',
  }
}

class MemoryStore implements AnalyticsStore {
  events: AnalyticsEvent[] = []
  saltCalls = 0
  failNextInsert = false
  earliestReportDay: string | null = null

  async getOrCreateDailySalt(): Promise<Uint8Array> {
    this.saltCalls += 1
    return new Uint8Array(32).fill(7)
  }

  async insertEvent(event: AnalyticsEvent): Promise<void> {
    if (this.failNextInsert) {
      this.failNextInsert = false
      throw new Error('insert failed')
    }
    this.events.push(event)
  }

  async getRollupCursor(): Promise<string | null> {
    return null
  }

  async getEarliestEventDay(): Promise<string | null> {
    return null
  }

  async getEarliestReportDay(): Promise<string | null> {
    return this.earliestReportDay
  }

  async rebuildDay(_options: AnalyticsRollupDayOptions): Promise<void> {}

  async prune(_options: AnalyticsPruneOptions): Promise<AnalyticsPruneResult> {
    return { events: 0, salts: 0, pathAggregates: 0, referrerAggregates: 0 }
  }

  async getSummary(_range: AnalyticsDateRange): Promise<[]> {
    return []
  }

  async getTopPaths(_query: Required<AnalyticsTopQuery>): Promise<{ rows: []; total: 0 }> {
    return { rows: [], total: 0 }
  }

  async getReferrers(_query: Required<AnalyticsLimitQuery>): Promise<{ rows: []; total: 0 }> {
    return { rows: [], total: 0 }
  }

  async getCountries(_range: AnalyticsDateRange): Promise<[]> {
    return []
  }

  async deleteEvents(): Promise<number> {
    return 0
  }
}
