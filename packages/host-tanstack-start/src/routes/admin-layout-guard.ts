/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Admin layout guard — decides between loading the authenticated layout
 * context, renewing an expired session in the browser, and redirecting to
 * sign-in.
 *
 * Renewal is explicit and browser-driven, so the two render contexts behave
 * differently on `ERR_ACCESS_EXPIRED`:
 *
 *   - **Browser navigation** runs the coordinated renewal right here and
 *     retries the load once. The user stays on the requested URL and sees
 *     only the ordinary route pending state.
 *   - **Server render** cannot rotate credentials (SSR never holds the
 *     browser lock), and a server-side `beforeLoad` error would surface as
 *     an HTTP 500, so the server redirects to the sign-in route. That route's
 *     bootstrap performs the same renewal and returns to `callbackUrl`.
 *
 * Any renewal failure in the browser falls back to the same sign-in redirect:
 * the sign-in bootstrap retries renewal once more and owns the terminal and
 * service-failure presentation, so this guard adds no second error surface.
 * Once renewal has succeeded, the retried load is treated like the initial
 * one: auth outcomes redirect, everything else propagates.
 */

import { redirect } from '@tanstack/react-router'

const AUTH_REDIRECT_CODES = new Set([
  'ERR_UNAUTHENTICATED',
  'ERR_ACCESS_EXPIRED',
  'ERR_INVALID_TOKEN',
  'ERR_REVOKED_TOKEN',
  'ERR_ACCOUNT_DISABLED',
  'ERR_SESSION_CHANGED',
])

export interface AdminLayoutGuardDeps<T> {
  /** Load the full layout context; expected to verify the access credential first. */
  load: () => Promise<T>
  /** Coordinated browser renewal. Resolves on success and rejects on any failure. */
  renewSession: () => Promise<void>
  isBrowser: boolean
  /** True when the page has already flagged a session change awaiting acknowledgement. */
  sessionChanged: () => boolean
  signInPath: string
  /** The requested location, preserved as `callbackUrl` on redirect. */
  href: string
}

export async function loadAdminLayoutContext<T>(deps: AdminLayoutGuardDeps<T>): Promise<T> {
  const toSignIn = () =>
    redirect({
      to: deps.signInPath as never,
      search: { callbackUrl: deps.href } as never,
    })
  try {
    return await deps.load()
  } catch (error) {
    const code = errorCode(error)
    const changed = deps.isBrowser && deps.sessionChanged()
    if (!changed && !AUTH_REDIRECT_CODES.has(code)) throw error
    if (changed || !deps.isBrowser || code !== 'ERR_ACCESS_EXPIRED') throw toSignIn()
  }
  try {
    await deps.renewSession()
  } catch {
    // Terminal auth outcomes and service failures during renewal both hand
    // over to the sign-in bootstrap, which owns retry and the terminal
    // presentation.
    throw toSignIn()
  }
  try {
    return await deps.load()
  } catch (error) {
    // The session is renewed at this point. Only an auth outcome sends the
    // user to sign-in; any other layout dependency failure reaches the
    // route's error handling exactly as it would on the initial load.
    if (AUTH_REDIRECT_CODES.has(errorCode(error))) throw toSignIn()
    throw error
  }
}

function errorCode(error: unknown): string {
  return (error as { code?: unknown })?.code as string
}
