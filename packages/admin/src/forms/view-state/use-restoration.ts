/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type RefObject, useEffect, useRef } from 'react'

import type { EditorViewStateStore } from './editor-view-state'

/**
 * Bounds for waiting on a target that is still mounting. The wait ends once
 * the form has had no DOM mutation for this many frames or milliseconds,
 * whichever comes first, and never runs longer than the hard cap.
 */
const QUIET_FRAMES = 30
const QUIET_MS = 500
const MAX_WAIT_MS = 5000

const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now())

function nextFrame(callback: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const handle = requestAnimationFrame(callback)
    return () => cancelAnimationFrame(handle)
  }
  const handle = setTimeout(callback, 16)
  return () => clearTimeout(handle)
}

/**
 * Calls `attempt(final)` once per animation frame until it reports done.
 * `final` turns true once the form has gone quiet (or the cap is reached),
 * and the attempt must then finish, falling back if it has to.
 */
function waitForTarget(form: HTMLElement, attempt: (final: boolean) => boolean): () => void {
  const start = now()
  let lastMutation = start
  let quietFrames = 0
  let cancelFrame: () => void = () => {}
  const observer =
    typeof MutationObserver === 'function'
      ? new MutationObserver(() => {
          quietFrames = 0
          lastMutation = now()
        })
      : null
  observer?.observe(form, { childList: true, subtree: true, attributes: true })

  const stop = () => {
    observer?.disconnect()
    cancelFrame()
  }
  const tick = () => {
    quietFrames++
    const time = now()
    const final =
      quietFrames >= QUIET_FRAMES || time - lastMutation >= QUIET_MS || time - start >= MAX_WAIT_MS
    if (attempt(final)) {
      stop()
      return
    }
    cancelFrame = nextFrame(tick)
  }
  cancelFrame = nextFrame(tick)
  return stop
}

export function scrollIntoViewInstantly(element: HTMLElement): void {
  // `html { scroll-behavior: smooth }` would otherwise animate, and the
  // editor's next input could cancel the animation part-way.
  element.scrollIntoView?.({ block: 'nearest', behavior: 'instant' })
}

/** Scrolls by `delta` pixels without the page's smooth-scroll animation. */
export function scrollByInstantly(delta: number): void {
  if (delta !== 0) window.scrollBy({ top: delta, behavior: 'instant' })
}

/**
 * One kind of restoration a form instance can consume: the restoration after
 * a save, or after another navigation within the visit.
 */
export interface RestorationSource<R> {
  /** The pending restoration, once this form instance is ready for it. */
  take(): R | null
  /** Whether `restore` may still run. */
  isLive(restore: R): boolean
  /** Ends `restore`; nothing more may fire for it. */
  finish(restore: R): void
  /**
   * One attempt. Returns true once the restoration is finished, after
   * calling `finish` itself; false to try again on the next frame. When
   * `final` is true the attempt must finish, falling back if it has to.
   */
  attempt(restore: R, final: boolean): boolean
}

/**
 * Runs one kind of restoration for a form instance:
 *
 *   1. The restoration is consumed in a committed effect, once `source.take()`
 *      says this instance is ready for it. The effect re-runs whenever
 *      `readinessKey` changes, and whenever the store notifies.
 *   2. When the first attempt cannot finish (its target is still mounting),
 *      it is retried frame by frame until the form goes quiet.
 *   3. A restoration that stops being live (the editor moved on, a newer one
 *      began) ends the wait, and a newer pending restoration is picked up.
 *
 * A consumed restoration is kept in a ref, so a StrictMode effect replay
 * resumes it; a real unmount ends it. Callbacks are read through a ref, so a
 * re-render with new callbacks does not restart a wait.
 */
export function useRestoration<R>(
  formRef: RefObject<HTMLFormElement | null>,
  store: EditorViewStateStore | null,
  source: RestorationSource<R>,
  readinessKey: string
): void {
  const sourceRef = useRef(source)
  sourceRef.current = source
  const consumedRef = useRef<R | null>(null)
  const generationRef = useRef(0)

  useEffect(() => {
    // `readinessKey` is a trigger only: `take()` reads the latest values.
    void readinessKey
    if (store == null) return
    const generation = ++generationRef.current
    let disposed = false
    let stopWaiting: (() => void) | null = null

    const runAttempt = (final: boolean): boolean => {
      const restore = consumedRef.current
      if (restore == null) return true
      if (!sourceRef.current.isLive(restore)) {
        consumedRef.current = null
        return true
      }
      const done = sourceRef.current.attempt(restore, final)
      if (done && consumedRef.current === restore) consumedRef.current = null
      return done
    }

    const proceed = () => {
      if (disposed) return
      if (stopWaiting) {
        // A wait is running. Keep it unless a newer restoration (or a
        // move-on) has made it obsolete; then drop it and reconcile now,
        // because the notification that made the newer one eligible may be
        // the last one it gets.
        const waiting = consumedRef.current
        if (waiting != null && sourceRef.current.isLive(waiting)) return
        stopWaiting()
        stopWaiting = null
        consumedRef.current = null
      }
      if (consumedRef.current == null) {
        const taken = sourceRef.current.take()
        if (taken == null || !sourceRef.current.isLive(taken)) return
        consumedRef.current = taken
      }
      if (runAttempt(false)) return
      const form = formRef.current
      if (form == null) return
      stopWaiting = waitForTarget(form, (final) => {
        const done = runAttempt(final)
        if (done) {
          stopWaiting = null
          // The wait may have ended because it was superseded: pick up a
          // newer pending restoration rather than waiting for another notify.
          queueMicrotask(proceed)
        }
        return done
      })
    }

    proceed()
    // A restoration can be recorded after this instance has already rendered
    // what it waits for (the singleton host refreshes before its handler
    // resolves).
    const unsubscribe = store.subscribe(proceed)
    return () => {
      disposed = true
      unsubscribe()
      stopWaiting?.()
      stopWaiting = null
      // A StrictMode replay or a dependency change re-runs this effect in the
      // same flush and resumes the consumed restoration. A real unmount does
      // not: end the restoration so it neither fires later nor keeps its
      // session live.
      queueMicrotask(() => {
        const orphaned = consumedRef.current
        if (generationRef.current !== generation || orphaned == null) return
        consumedRef.current = null
        sourceRef.current.finish(orphaned)
      })
    }
  }, [formRef, readinessKey, store])
}
