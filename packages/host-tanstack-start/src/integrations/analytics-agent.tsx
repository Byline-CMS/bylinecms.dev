'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'
import { useEffect, useRef } from 'react'
import { useRouterState } from '@tanstack/react-router'

import { ANALYTICS_NAVIGATION_EVENT, ANALYTICS_STOP_EVENT } from '@byline/analytics-agent'

let pendingStopTimer: number | undefined

export interface AnalyticsAgentProps {
  /** Application-owned same-origin route that receives browser events. */
  endpoint: string
  src?: string
  cdnHosts?: readonly string[]
  downloadExtensions?: readonly string[]
  ignoredPathPrefixes?: readonly string[]
  countSearchChanges?: boolean
  countHashChanges?: boolean
}

/** Render the standalone script and bridge only committed router locations into it. */
export function AnalyticsAgent({
  endpoint,
  src = '/b.js',
  cdnHosts,
  downloadExtensions,
  ignoredPathPrefixes,
  countSearchChanges = false,
  countHashChanges = false,
}: AnalyticsAgentProps): React.JSX.Element {
  return (
    <>
      <script
        defer
        src={src}
        data-endpoint={endpoint}
        data-cdn-hosts={boundedAttribute(cdnHosts)}
        data-download-extensions={boundedAttribute(downloadExtensions)}
        data-ignore-prefixes={boundedAttribute(ignoredPathPrefixes)}
        data-count-search={countSearchChanges ? 'true' : undefined}
        data-count-hash={countHashChanges ? 'true' : undefined}
      />
      <AnalyticsNavigationBridge />
    </>
  )
}

function AnalyticsNavigationBridge(): null {
  const href = useRouterState({ select: (state) => state.location.href })
  const previousHref = useRef<string | undefined>(undefined)

  useEffect(() => {
    const previous = previousHref.current
    previousHref.current = href
    if (previous == null || previous === href) return
    document.dispatchEvent(new CustomEvent(ANALYTICS_NAVIGATION_EVENT, { detail: href }))
  }, [href])

  useEffect(() => {
    if (pendingStopTimer !== undefined) {
      window.clearTimeout(pendingStopTimer)
      pendingStopTimer = undefined
    }

    return () => {
      // React Strict Mode immediately re-runs this effect after its simulated
      // cleanup. Deferring the stop lets that setup cancel it, while a real
      // consent-driven unmount leaves the timer in place.
      pendingStopTimer = window.setTimeout(() => {
        pendingStopTimer = undefined
        document.dispatchEvent(new Event(ANALYTICS_STOP_EVENT))
      }, 0)
    }
  }, [])

  return null
}

function boundedAttribute(values: readonly string[] | undefined): string | undefined {
  if (values == null || values.length === 0) return undefined
  return values.slice(0, 64).join(',').slice(0, 2_048)
}
