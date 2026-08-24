/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createHash } from 'node:crypto'

import type { AnalyticsEvent, AnalyticsStore } from '@byline/analytics'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

export interface AnalyticsConformanceHooks {
  createStore(): AnalyticsStore | Promise<AnalyticsStore>
  migrate(): Promise<void>
  reset(): Promise<void>
  teardown(): Promise<void>
}

/** Register the complete portable contract against one real backend. */
export function runAnalyticsStoreConformanceSuite(hooks: AnalyticsConformanceHooks): void {
  let store: AnalyticsStore

  beforeAll(async () => {
    await hooks.migrate()
    store = await hooks.createStore()
  })

  beforeEach(async () => {
    await hooks.reset()
  })

  afterAll(async () => {
    try {
      await hooks.reset()
    } finally {
      await hooks.teardown()
    }
  })

  describe('AnalyticsStore conformance', () => {
    it('converges concurrent daily-salt candidates on one winning value', async () => {
      const candidates = [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)]
      const [left, right] = await Promise.all(
        candidates.map((candidate) => store.getOrCreateDailySalt('2026-08-20', candidate))
      )
      expect(left).toEqual(right)
      expect(candidates).toContainEqual(left)
    })

    it('queries unrolled events as sums of daily unique visitors', async () => {
      await insertAll(store, [
        event('2026-08-20T01:00:00Z', 'page', '/one', 'a', 'alpha.example', 'TH'),
        event('2026-08-20T02:00:00Z', 'page', '/one', 'a', 'alpha.example', 'TH'),
        event('2026-08-20T03:00:00Z', 'page', '/two', 'b', 'beta.example', 'US'),
        event('2026-08-20T04:00:00Z', 'download', '/file.pdf', 'a', null, 'TH'),
        event('2026-08-21T01:00:00Z', 'page', '/one', 'a', 'alpha.example', 'TH'),
      ])

      expect(await store.getSummary({ from: '2026-08-20', to: '2026-08-22' })).toEqual([
        { day: '2026-08-20', views: 3, visitors: 2, downloads: 1 },
        { day: '2026-08-21', views: 1, visitors: 1, downloads: 0 },
        { day: '2026-08-22', views: 0, visitors: 0, downloads: 0 },
      ])
      expect(
        (
          await store.getTopPaths({
            kind: 'page',
            from: '2026-08-20',
            to: '2026-08-22',
            limit: 20,
          })
        ).rows
      ).toEqual([
        { path: '/one', views: 3, visitors: 2 },
        { path: '/two', views: 1, visitors: 1 },
      ])
      expect(
        (await store.getReferrers({ from: '2026-08-20', to: '2026-08-22', limit: 20 })).rows
      ).toEqual([
        { referrerHost: 'alpha.example', views: 3, visitors: 2 },
        { referrerHost: 'beta.example', views: 1, visitors: 1 },
      ])
      expect(await store.getCountries({ from: '2026-08-20', to: '2026-08-22' })).toEqual([
        { country: 'TH', views: 3, visitors: 2 },
        { country: 'US', views: 1, visitors: 1 },
      ])
    })

    it('attributes events on either side of UTC midnight to the correct day', async () => {
      await insertAll(store, [
        event('2026-08-20T23:59:59.999Z', 'page', '/before-midnight', 'a', null, null),
        event('2026-08-21T00:00:00.000Z', 'page', '/at-midnight', 'b', null, null),
      ])

      expect(await store.getSummary({ from: '2026-08-20', to: '2026-08-21' })).toEqual([
        { day: '2026-08-20', views: 1, visitors: 1, downloads: 0 },
        { day: '2026-08-21', views: 1, visitors: 1, downloads: 0 },
      ])
    })

    it('discovers the earliest reportable day and stitches retained rollups with newer raw data', async () => {
      expect(await store.getEarliestReportDay()).toBeNull()

      await store.insertEvent(
        event('2025-12-31T23:00:00Z', 'page', '/old', 'old', 'old.example', 'TH')
      )
      expect(await store.getEarliestReportDay()).toBe('2025-12-31')
      await store.rebuildDay({
        day: '2025-12-31',
        pathCardinalityCap: 20,
        referrerCardinalityCap: 20,
        advanceCursor: true,
      })
      await store.prune({
        eventsBefore: new Date('2026-01-01T00:00:00.000Z'),
        saltsBefore: '2025-12-31',
        pathAggregatesBefore: null,
        referrerAggregatesBefore: null,
      })
      await store.insertEvent(
        event('2026-01-02T01:00:00Z', 'page', '/new', 'new', 'new.example', 'US')
      )

      expect(await store.getEarliestReportDay()).toBe('2025-12-31')
      expect(await store.getSummary({ from: '2025-12-31', to: '2026-01-02' })).toEqual([
        { day: '2025-12-31', views: 1, visitors: 1, downloads: 0 },
        { day: '2026-01-01', views: 0, visitors: 0, downloads: 0 },
        { day: '2026-01-02', views: 1, visitors: 1, downloads: 0 },
      ])
    })

    it('rebuilds capped daily aggregates idempotently and stitches later raw events', async () => {
      const events: AnalyticsEvent[] = []
      for (let index = 0; index < 20; index += 1) {
        const path = `/top-${String(index).padStart(2, '0')}`
        const referrer = `top-${String(index).padStart(2, '0')}.example`
        events.push(
          event('2026-08-20T01:00:00Z', 'page', path, `a-${index}`, referrer, 'TH'),
          event('2026-08-20T02:00:00Z', 'page', path, `b-${index}`, referrer, 'TH')
        )
      }
      for (let index = 0; index < 3; index += 1) {
        events.push(
          event(
            '2026-08-20T03:00:00Z',
            'page',
            `/z-overflow-${index}`,
            'overflow-visitor',
            `z-overflow-${index}.example`,
            'TH'
          )
        )
      }
      await insertAll(store, events)

      const rollup = {
        day: '2026-08-20',
        pathCardinalityCap: 20,
        referrerCardinalityCap: 20,
        advanceCursor: true,
      }
      await store.rebuildDay(rollup)
      await store.rebuildDay(rollup)

      const capped = await store.getTopPaths({
        kind: 'page',
        from: '2026-08-20',
        to: '2026-08-20',
        limit: 100,
      })
      const paths = capped.rows
      expect(paths).toHaveLength(21)
      // The cap folded the tail into one reserved row, so the distinct-key
      // total is the capped set, not the pre-cap path count.
      expect(capped.total).toBe(21)
      expect(paths.find((row) => row.path === '__other__')).toEqual({
        path: '__other__',
        views: 3,
        visitors: 1,
      })
      expect(paths.reduce((sum, row) => sum + row.views, 0)).toBe(43)

      const cappedReferrers = await store.getReferrers({
        from: '2026-08-20',
        to: '2026-08-20',
        limit: 100,
      })
      const referrers = cappedReferrers.rows
      expect(referrers).toHaveLength(21)
      expect(cappedReferrers.total).toBe(21)
      expect(referrers.find((row) => row.referrerHost === '__other__')).toEqual({
        referrerHost: '__other__',
        views: 3,
        visitors: 1,
      })
      expect(await store.getSummary({ from: '2026-08-20', to: '2026-08-20' })).toEqual([
        { day: '2026-08-20', views: 43, visitors: 41, downloads: 0 },
      ])

      await store.insertEvent(event('2026-08-21T01:00:00Z', 'page', '/later', 'later', null, 'US'))
      expect(await store.getSummary({ from: '2026-08-20', to: '2026-08-21' })).toEqual([
        { day: '2026-08-20', views: 43, visitors: 41, downloads: 0 },
        { day: '2026-08-21', views: 1, visitors: 1, downloads: 0 },
      ])
    })

    it('reports the distinct-key total independently of the top-N limit', async () => {
      await insertAll(
        store,
        Array.from({ length: 7 }, (_, index) =>
          event(
            '2026-08-20T01:00:00Z',
            'page',
            `/page-${index}`,
            `visitor-${index}`,
            `ref-${index}.example`,
            'TH'
          )
        )
      )

      const paths = await store.getTopPaths({
        kind: 'page',
        from: '2026-08-20',
        to: '2026-08-20',
        limit: 3,
      })
      // Three rows returned, but the caller learns there are seven, so the
      // interface can say "top 3 of 7" instead of implying it has them all.
      expect(paths.rows).toHaveLength(3)
      expect(paths.total).toBe(7)

      const referrers = await store.getReferrers({
        from: '2026-08-20',
        to: '2026-08-20',
        limit: 2,
      })
      expect(referrers.rows).toHaveLength(2)
      expect(referrers.total).toBe(7)
    })

    it('advances empty days but never moves the cursor during a manual rebuild', async () => {
      await store.rebuildDay({
        day: '2026-08-20',
        pathCardinalityCap: 20,
        referrerCardinalityCap: 20,
        advanceCursor: true,
      })
      expect(await store.getRollupCursor()).toBe('2026-08-20')
      await store.rebuildDay({
        day: '2026-08-19',
        pathCardinalityCap: 20,
        referrerCardinalityCap: 20,
        advanceCursor: false,
      })
      expect(await store.getRollupCursor()).toBe('2026-08-20')
    })

    it('prunes raw events, salts, path, and referrer rows but retains site and country history', async () => {
      await store.insertEvent(
        event('2026-01-01T01:00:00Z', 'page', '/retained-total', 'a', 'old.example', 'TH')
      )
      await store.rebuildDay({
        day: '2026-01-01',
        pathCardinalityCap: 20,
        referrerCardinalityCap: 20,
        advanceCursor: true,
      })
      await store.getOrCreateDailySalt('2025-12-31', new Uint8Array(32).fill(1))
      await store.getOrCreateDailySalt('2026-01-01', new Uint8Array(32).fill(2))
      await store.getOrCreateDailySalt('2026-01-02', new Uint8Array(32).fill(3))

      expect(
        await store.prune({
          eventsBefore: new Date('2026-01-02T00:00:00.000Z'),
          saltsBefore: '2026-01-02',
          pathAggregatesBefore: '2026-01-02',
          referrerAggregatesBefore: '2026-01-02',
        })
      ).toEqual({ events: 1, salts: 2, pathAggregates: 1, referrerAggregates: 1 })

      expect(await store.getSummary({ from: '2026-01-01', to: '2026-01-01' })).toEqual([
        { day: '2026-01-01', views: 1, visitors: 1, downloads: 0 },
      ])
      expect(await store.getCountries({ from: '2026-01-01', to: '2026-01-01' })).toEqual([
        { country: 'TH', views: 1, visitors: 1 },
      ])
      expect(
        await store.getTopPaths({
          kind: 'page',
          from: '2026-01-01',
          to: '2026-01-01',
          limit: 20,
        })
      ).toEqual({ rows: [], total: 0 })
      expect(await store.getReferrers({ from: '2026-01-01', to: '2026-01-01', limit: 20 })).toEqual(
        { rows: [], total: 0 }
      )
    })

    it('deletes a half-open event range with an optional visitor filter', async () => {
      await insertAll(store, [
        event('2026-08-20T00:00:00Z', 'page', '/outside-before', 'target', null, null),
        event('2026-08-20T01:00:00Z', 'page', '/delete-one', 'target', null, null),
        event('2026-08-20T02:00:00Z', 'page', '/delete-two', 'target', null, null),
        event('2026-08-20T02:00:00Z', 'page', '/keep-other', 'other', null, null),
        event('2026-08-20T03:00:00Z', 'page', '/outside-at-to', 'target', null, null),
      ])

      const targetHash = createHash('sha256').update('target').digest('hex')
      expect(
        await store.deleteEvents({
          from: new Date('2026-08-20T01:00:00Z'),
          to: new Date('2026-08-20T03:00:00Z'),
          visitorHash: targetHash,
        })
      ).toBe(2)
      expect(await store.getSummary({ from: '2026-08-20', to: '2026-08-20' })).toEqual([
        { day: '2026-08-20', views: 3, visitors: 2, downloads: 0 },
      ])

      expect(
        await store.deleteEvents({
          from: new Date('2026-08-20T00:00:00Z'),
          to: new Date('2026-08-20T04:00:00Z'),
        })
      ).toBe(3)
      expect(await store.getSummary({ from: '2026-08-20', to: '2026-08-20' })).toEqual([
        { day: '2026-08-20', views: 0, visitors: 0, downloads: 0 },
      ])
    })
  })
}

function event(
  occurredAt: string,
  kind: 'page' | 'download',
  path: string,
  visitor: string,
  referrerHost: string | null,
  country: string | null
): AnalyticsEvent {
  return {
    occurredAt: new Date(occurredAt),
    kind,
    source: 'beacon',
    path,
    visitorHash: createHash('sha256').update(visitor).digest('hex'),
    referrerHost,
    country,
  }
}

async function insertAll(store: AnalyticsStore, events: readonly AnalyticsEvent[]): Promise<void> {
  for (const value of events) await store.insertEvent(value)
}
