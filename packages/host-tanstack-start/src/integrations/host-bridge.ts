/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * The TanStack Start implementation of `HostRequestBridge` — the three
 * request primitives (`getRequest` identity, cookie read, cookie write)
 * that `@byline/client/server` is written against.
 *
 * Registered as a module side effect: every module in this package that
 * fronts the server-side client stack imports this file first, so any
 * code path that can reach a getter has already registered the bridge.
 * Registration is idempotent (last-write-wins on a `globalThis` symbol
 * slot), so repeated evaluation across Vite SSR module graphs is
 * harmless.
 */

import { getCookie, getRequest, setCookie } from '@tanstack/react-start/server'

import {
  type HostCookieSetOptions,
  type HostRequestBridge,
  registerHostRequestBridge,
} from '@byline/core'

const tanstackStartRequestBridge: HostRequestBridge = {
  getRequest(): object | undefined {
    try {
      return getRequest()
    } catch {
      // No StartEvent in AsyncLocalStorage — running outside a request.
      return undefined
    }
  },
  getCookie(name: string): string | undefined {
    return getCookie(name)
  },
  setCookie(name: string, value: string, options?: HostCookieSetOptions): void {
    setCookie(name, value, options)
  },
}

/**
 * Register the TanStack Start bridge. Safe to call any number of times;
 * exported for hosts that want registration to be explicit in their
 * server config rather than relying on a side-effect import.
 */
export function registerTanstackStartHostBridge(): void {
  registerHostRequestBridge(tanstackStartRequestBridge)
}

registerTanstackStartHostBridge()
