/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Cookie helpers for admin session management.
 *
 * Two separate httpOnly cookies, one for each token half:
 *
 *   - `byline_access_token`  — short-lived JWT; sent on every request.
 *   - `byline_refresh_token` — long-lived opaque string; consumed only by
 *                              the explicit renewal endpoint to mint a
 *                              replacement access token.
 *
 * Renewal is explicit, not implicit. `getAdminRequestContext()` only
 * verifies the access cookie and never writes or clears cookies; the
 * browser transport calls the host's CSRF-protected renewal server fn
 * after a pre-handler `ERR_ACCESS_EXPIRED` outcome, and that endpoint is
 * the only place refresh rotation writes new cookies.
 *
 * All cookies set here use:
 *   - `httpOnly: true`   — inaccessible to JavaScript (XSS-hardened).
 *   - `sameSite: 'lax'`  — sent on top-level navigations but not
 *                          cross-origin subrequests (reasonable default
 *                          for an admin SSR app).
 *   - `secure: true` in production — https-only; dev keeps it off so
 *                          cookies work on http://localhost.
 *   - `path: '/'`        — available everywhere in the app.
 *
 * Cookie transport goes through the registered `HostRequestBridge`, so
 * this module is host-framework agnostic.
 */

import { getHostRequestBridge } from '@byline/core'

export const ACCESS_TOKEN_COOKIE = 'byline_access_token'
export const REFRESH_TOKEN_COOKIE = 'byline_refresh_token'

const IS_PROD = process.env.NODE_ENV === 'production'

/** Read the access-token cookie. Returns undefined when not present. */
export function readAccessTokenCookie(): string | undefined {
  return getHostRequestBridge().getCookie(ACCESS_TOKEN_COOKIE)
}

/** Read the refresh-token cookie. Returns undefined when not present. */
export function readRefreshTokenCookie(): string | undefined {
  return getHostRequestBridge().getCookie(REFRESH_TOKEN_COOKIE)
}

export interface SessionCookieTokens {
  accessToken: string
  refreshToken: string
  accessTokenExpiresAt: Date
  refreshTokenExpiresAt: Date
}

/**
 * Write both access and refresh cookies. Called after a successful sign-in
 * and after a confirmed rotation in the explicit renewal server fn.
 *
 * `maxAge` is derived from each token's own expiry claim so the browser
 * drops the cookies at the same moment the server would reject them —
 * saves round trips when the refresh token has fully expired.
 */
export function setSessionCookies(tokens: SessionCookieTokens): void {
  const bridge = getHostRequestBridge()
  const now = Date.now()
  const accessMaxAgeSeconds = Math.max(
    0,
    Math.floor((tokens.accessTokenExpiresAt.getTime() - now) / 1000)
  )
  const refreshMaxAgeSeconds = Math.max(
    0,
    Math.floor((tokens.refreshTokenExpiresAt.getTime() - now) / 1000)
  )

  bridge.setCookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
    maxAge: accessMaxAgeSeconds,
  })

  bridge.setCookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
    maxAge: refreshMaxAgeSeconds,
  })
}

/**
 * Clear both session cookies. Called only after a confirmed sign-out or a
 * successful self-service password change. Authentication and renewal
 * failures deliberately do not clear cookies: a late failure response must
 * not erase credentials that a concurrent renewal or sign-in just installed.
 */
export function clearSessionCookies(): void {
  const bridge = getHostRequestBridge()
  bridge.setCookie(ACCESS_TOKEN_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
    maxAge: 0,
  })
  bridge.setCookie(REFRESH_TOKEN_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
    maxAge: 0,
  })
}
