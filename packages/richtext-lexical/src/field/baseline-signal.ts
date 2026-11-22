/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/** How the value whose baseline is established fared against the editor. */
export type BaselineStatus = 'ok' | 'adapted'

/**
 * Whether `ApplyValuePlugin` has established the emission baseline for the
 * value the editor currently holds. `ready` is called exactly where the
 * plugin sets `hasNormalizedBaselineRef.current = true`; `reset` wherever it
 * starts applying a different value, refuses one, or receives null. Reading
 * it leaves the emission gate unchanged.
 */
export interface BaselineSignal {
  /** The established baseline's status, or `null` while none is established. */
  status(): BaselineStatus | null
  ready(status: BaselineStatus): void
  reset(): void
  /** Notified when a baseline becomes established. */
  subscribe(listener: () => void): () => void
}

export function createBaselineSignal(): BaselineSignal {
  const listeners = new Set<() => void>()
  let current: BaselineStatus | null = null
  return {
    status: () => current,
    ready(status) {
      current = status
      for (const listener of [...listeners]) listener()
    },
    reset() {
      current = null
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
