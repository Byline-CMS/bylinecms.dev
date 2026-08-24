/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { BylineLogger } from '@byline/core'

import { analyticsDay } from './date.js'
import type {
  AnalyticsDropReason,
  AnalyticsIngestResult,
  AnalyticsMetricsSnapshot,
  AnalyticsRejectReason,
} from './types.js'

const OUTCOMES = [
  'origin',
  'admin-path',
  'bot',
  'prefetch',
  'client-ip',
  'dedupe',
  'method',
  'body-size',
  'malformed',
] as const satisfies readonly (AnalyticsDropReason | AnalyticsRejectReason)[]

export class AnalyticsMetrics {
  #day: string
  #accepted = 0
  #drops = emptyDrops()
  #previousAccepted: number | null = null

  constructor(
    now: Date,
    private logger?: BylineLogger
  ) {
    this.#day = analyticsDay(now)
  }

  setLogger(logger: BylineLogger): void {
    this.logger = logger
  }

  record(result: AnalyticsIngestResult, now: Date): void {
    this.rotate(now)
    if (result.accepted) this.#accepted += 1
    else this.#drops[result.reason] += 1
  }

  snapshot(now = new Date()): AnalyticsMetricsSnapshot {
    this.rotate(now)
    return {
      day: this.#day,
      accepted: this.#accepted,
      drops: { ...this.#drops },
    }
  }

  private rotate(now: Date): void {
    const nextDay = analyticsDay(now)
    if (nextDay === this.#day) return

    const snapshot = { day: this.#day, accepted: this.#accepted, drops: { ...this.#drops } }
    this.logger?.info({ analytics: snapshot }, '[analytics] daily ingest counters')
    if (
      this.#previousAccepted != null &&
      this.#previousAccepted > 0 &&
      this.#accepted > this.#previousAccepted * 5
    ) {
      this.logger?.warn(
        { day: this.#day, accepted: this.#accepted, previousAccepted: this.#previousAccepted },
        '[analytics] accepted events increased by more than 5x day over day'
      )
    }
    this.#previousAccepted = this.#accepted
    this.#day = nextDay
    this.#accepted = 0
    this.#drops = emptyDrops()
  }
}

function emptyDrops(): Record<AnalyticsDropReason | AnalyticsRejectReason, number> {
  return Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0])) as Record<
    AnalyticsDropReason | AnalyticsRejectReason,
    number
  >
}
