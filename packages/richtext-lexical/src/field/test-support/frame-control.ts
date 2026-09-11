/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Deterministic control over the frames and idle callbacks the editor
 * defers work through.
 *
 * Two pieces of editor behaviour are scheduled rather than immediate,
 * and a test that waits a fixed number of milliseconds for either is
 * guessing:
 *
 *  - `ApplyValuePlugin` captures its normalization baseline after a
 *    microtask and **two** animation frames.
 *  - `editor-component` defers change emission through
 *    `requestIdleCallback`, which jsdom does not implement at all — so
 *    without a shim it takes a synchronous branch and an entire class of
 *    ordering bug becomes invisible.
 *
 * Installing controllable versions of both makes the ordering explicit:
 * a test says when a frame happens, rather than sleeping and hoping.
 */

interface FrameControl {
  /** Run pending animation-frame callbacks, `generations` deep. */
  flushFrames: (generations?: number) => Promise<void>
  /** Run every pending idle callback. */
  flushIdle: () => void
  /** How many idle callbacks are scheduled but not yet run. */
  pendingIdle: () => number
  /** Settle the normalization baseline: a microtask, then two frames. */
  settleBaseline: () => Promise<void>
  /** Restore the original globals. */
  restore: () => void
}

export function installFrameControl(): FrameControl {
  const frameCallbacks: FrameRequestCallback[] = []
  const idleCallbacks: Array<() => void> = []

  const originalRaf = globalThis.requestAnimationFrame
  const originalCaf = globalThis.cancelAnimationFrame
  // biome-ignore lint/suspicious/noExplicitAny: jsdom does not implement these
  const originalRic = (globalThis as any).requestIdleCallback
  // biome-ignore lint/suspicious/noExplicitAny: jsdom does not implement these
  const originalCic = (globalThis as any).cancelIdleCallback

  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    frameCallbacks.push(callback)
    return frameCallbacks.length
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame
  // biome-ignore lint/suspicious/noExplicitAny: shimming a missing jsdom API
  ;(globalThis as any).requestIdleCallback = (callback: () => void) => {
    idleCallbacks.push(callback)
    return idleCallbacks.length
  }
  // biome-ignore lint/suspicious/noExplicitAny: shimming a missing jsdom API
  ;(globalThis as any).cancelIdleCallback = () => {}

  const flushFrames = async (generations = 1): Promise<void> => {
    for (let generation = 0; generation < generations; generation++) {
      // Drain microtasks first: the plugin schedules its first frame
      // from inside `queueMicrotask`.
      await Promise.resolve()
      for (const callback of frameCallbacks.splice(0)) callback(performance.now())
    }
    await Promise.resolve()
  }

  return {
    flushFrames,
    flushIdle: () => {
      for (const callback of idleCallbacks.splice(0)) callback()
    },
    pendingIdle: () => idleCallbacks.length,
    settleBaseline: () => flushFrames(2),
    restore: () => {
      globalThis.requestAnimationFrame = originalRaf
      globalThis.cancelAnimationFrame = originalCaf
      // biome-ignore lint/suspicious/noExplicitAny: restoring a shimmed API
      ;(globalThis as any).requestIdleCallback = originalRic
      // biome-ignore lint/suspicious/noExplicitAny: restoring a shimmed API
      ;(globalThis as any).cancelIdleCallback = originalCic
    },
  }
}
