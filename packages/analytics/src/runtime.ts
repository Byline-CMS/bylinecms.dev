/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { Analytics } from './analytics.js'

const BYLINE_ANALYTICS_RUNTIME = Symbol.for('__byline_analytics_runtime__')

function runtimeSlot(): Record<PropertyKey, unknown> {
  return globalThis as unknown as Record<PropertyKey, unknown>
}

/** Register the installation-scoped analytics runtime for host integrations. */
export function registerAnalytics(analytics: Analytics): Analytics {
  runtimeSlot()[BYLINE_ANALYTICS_RUNTIME] = analytics
  return analytics
}

/** Return the registered runtime, or `null` when analytics is not enabled. */
export function tryGetAnalytics(): Analytics | null {
  if ('window' in globalThis) return null
  return (runtimeSlot()[BYLINE_ANALYTICS_RUNTIME] as Analytics | undefined) ?? null
}

/** Return the registered runtime and fail loudly when the subsystem is disabled. */
export function getAnalytics(): Analytics {
  const analytics = tryGetAnalytics()
  if (analytics == null) {
    throw new Error(
      'Byline analytics has not been registered. Call registerAnalytics() during server startup.'
    )
  }
  return analytics
}

export function isAnalyticsRegistered(): boolean {
  return tryGetAnalytics() != null
}
