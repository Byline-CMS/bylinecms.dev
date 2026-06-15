'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type RefObject, useCallback, useRef } from 'react'

/**
 * A dirty-tracked, ref-backed form slot with its own listener set — the shared
 * machinery behind the document-grain system fields (`path`, advertised
 * `availableLocales`, …). Each slot holds the current value, the value it was
 * loaded with, and a set of subscribers; a `set` that moves the value away from
 * its loaded baseline registers the slot's `dirtyKey` in the form's shared
 * dirty set (and clears it again when the value returns to baseline), so the
 * single Save button can branch on which buckets changed.
 *
 * Adding a new system slot is then a one-liner at the call site rather than a
 * copy of ref + initial-ref + listener-set + get/set/subscribe.
 */
export interface TrackedSlot<T> {
  /** Current value (live ref read — not React state). */
  get: () => T
  /** Write a value; toggles `dirtyKey` against the loaded baseline. */
  set: (value: T) => void
  /** Subscribe to value changes; returns an unsubscribe fn. */
  subscribe: (listener: (value: T) => void) => () => void
  /** Re-baseline: adopt the current value as the new "clean" baseline (called on save). */
  commitInitial: () => void
}

export interface UseTrackedSlotConfig<T> {
  /** Initial / loaded value. */
  initial: T
  /** Key registered in the shared dirty set while this slot diverges from baseline. */
  dirtyKey: string
  /** The form's shared dirty-key set. */
  dirtyFields: RefObject<Set<string>>
  /** Notify the form's meta listeners (drives hasChanges → Save button). */
  notifyMeta: () => void
  /** Equality against the baseline. Defaults to `===` (identity). */
  isEqual?: (a: T, b: T) => boolean
  /** Defensive copy on read-in / write. Defaults to identity (fine for immutables). */
  clone?: (value: T) => T
}

export function useTrackedSlot<T>(config: UseTrackedSlotConfig<T>): TrackedSlot<T> {
  // Snapshot the config on every render into a ref so the returned callbacks
  // can stay referentially stable (empty deps) while still reading the latest
  // isEqual / clone / notifyMeta — matching the stable identities the previous
  // inline implementation relied on.
  const cfgRef = useRef(config)
  cfgRef.current = config

  const clone = useCallback((value: T): T => {
    const fn = cfgRef.current.clone
    return fn ? fn(value) : value
  }, [])

  const valueRef = useRef<T>(clone(config.initial))
  const initialRef = useRef<T>(clone(config.initial))
  const listeners = useRef<Set<(value: T) => void>>(new Set())

  const get = useCallback(() => valueRef.current, [])

  const set = useCallback(
    (value: T) => {
      const { dirtyKey, dirtyFields, notifyMeta, isEqual } = cfgRef.current
      const next = clone(value)
      valueRef.current = next
      const equal = isEqual ? isEqual(next, initialRef.current) : next === initialRef.current
      if (equal) {
        dirtyFields.current.delete(dirtyKey)
      } else {
        dirtyFields.current.add(dirtyKey)
      }
      listeners.current.forEach((listener) => {
        listener(next)
      })
      notifyMeta()
    },
    [clone]
  )

  const subscribe = useCallback((listener: (value: T) => void) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  const commitInitial = useCallback(() => {
    initialRef.current = clone(valueRef.current)
  }, [clone])

  return { get, set, subscribe, commitInitial }
}
