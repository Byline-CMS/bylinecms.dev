'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * RouteProgressBar — global navigation progress indicator for the admin shell.
 *
 * Driven by TanStack Router's reactive state via `useRouterState`. The bar
 * appears across the top of the viewport whenever a route transition or
 * loader is in flight.
 *
 * Timing:
 *   - SHOW_DELAY_MS  — debounce before the bar appears. Sub-debounce
 *                      navigations (typical instant client-side transitions)
 *                      never show the bar at all.
 *   - MIN_VISIBLE_MS — once shown, the bar remains visible for at least this
 *                      long before the completion animation, so it never
 *                      flickers as a single-frame artefact.
 */

import { useEffect, useRef, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'

import cx from 'classnames'

import styles from './route-progress-bar.module.css'

const SHOW_DELAY_MS = 80
const MIN_VISIBLE_MS = 250
const FINISH_EXIT_MS = 350

type Phase = 'idle' | 'visible' | 'finishing'

export function RouteProgressBar() {
  const isNavigating = useRouterState({
    select: (s) => s.isLoading || s.isTransitioning,
  })
  const [phase, setPhase] = useState<Phase>('idle')
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visibleSinceRef = useRef<number | null>(null)

  useEffect(() => {
    const clearShow = () => {
      if (showTimerRef.current) {
        clearTimeout(showTimerRef.current)
        showTimerRef.current = null
      }
    }
    const clearFinish = () => {
      if (finishTimerRef.current) {
        clearTimeout(finishTimerRef.current)
        finishTimerRef.current = null
      }
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current)
        resetTimerRef.current = null
      }
    }

    if (isNavigating) {
      // A new navigation started — abort any pending exit animation.
      clearFinish()

      if (phase === 'finishing') {
        // Re-grab the bar mid-fade.
        visibleSinceRef.current = performance.now()
        setPhase('visible')
        return
      }
      if (phase === 'idle' && showTimerRef.current === null) {
        showTimerRef.current = setTimeout(() => {
          showTimerRef.current = null
          visibleSinceRef.current = performance.now()
          setPhase('visible')
        }, SHOW_DELAY_MS)
      }
      return
    }

    // Navigation finished.
    if (showTimerRef.current !== null) {
      // Still inside the debounce window — bar never appeared. No-op.
      clearShow()
      return
    }
    if (phase === 'visible') {
      const elapsed = performance.now() - (visibleSinceRef.current ?? 0)
      const wait = Math.max(0, MIN_VISIBLE_MS - elapsed)
      finishTimerRef.current = setTimeout(() => {
        finishTimerRef.current = null
        setPhase('finishing')
        resetTimerRef.current = setTimeout(() => {
          resetTimerRef.current = null
          visibleSinceRef.current = null
          setPhase('idle')
        }, FINISH_EXIT_MS)
      }, wait)
    }
  }, [isNavigating, phase])

  useEffect(() => {
    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current)
      if (finishTimerRef.current) clearTimeout(finishTimerRef.current)
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    }
  }, [])

  return (
    <div
      aria-hidden="true"
      className={cx('route-progress-bar', styles.bar, {
        [styles.barVisible]: phase === 'visible',
        'route-progress-bar-visible': phase === 'visible',
        [styles.barFinishing]: phase === 'finishing',
        'route-progress-bar-finishing': phase === 'finishing',
      })}
    />
  )
}
