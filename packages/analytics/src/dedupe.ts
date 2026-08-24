/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

export class AnalyticsDedupeCache {
  readonly #entries = new Map<string, number>()

  constructor(
    private readonly maxEntries: number,
    private readonly windowMs: number
  ) {}

  /** Returns true for a replay; otherwise records this event as the newest occurrence. */
  check(key: string, nowMs: number): boolean {
    const previous = this.#entries.get(key)
    if (previous != null && nowMs - previous < this.windowMs) return true

    this.#entries.delete(key)
    this.#entries.set(key, nowMs)
    this.evict(nowMs)
    return false
  }

  /** Remove a provisional entry when persistence failed. */
  forget(key: string): void {
    this.#entries.delete(key)
  }

  private evict(nowMs: number): void {
    for (const [key, timestamp] of this.#entries) {
      if (this.#entries.size <= this.maxEntries && nowMs - timestamp < this.windowMs) break
      this.#entries.delete(key)
    }
  }
}
