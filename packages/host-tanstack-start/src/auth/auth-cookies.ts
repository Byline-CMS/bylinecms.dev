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
 *   - `byline_refresh_token` — long-lived opaque string; sent back only
 *                              when the access cookie is missing or
 *                              expired, to mint a new access token.
 *
 * Presenting "one session" to the user is a function of the middleware —
 * `getAdminRequestContext()` transparently refreshes the access cookie
 * using the refresh cookie, so the UI layer doesn't have to care.
 *
 * All cookies set here use:
 *   - `httpOnly: true`   — inaccessible to JavaScript (XSS-hardened).
 *   - `sameSite: 'lax'`  — sent on top-level navigations but not
 *                          cross-origin subrequests (reasonable default
 *                          for an admin SSR app).
 *   - `secure: true` in production — https-only; dev keeps it off so
 *                          cookies work on http://localhost.
 *   - `path: '/'`        — available everywhere in the app.
 */

import { getCookie, setCookie } from '@tanstack/react-start/server'

export const ACCESS_TOKEN_COOKIE = 'byline_access_token'
export const REFRESH_TOKEN_COOKIE = 'byline_refresh_token'

const IS_PROD = process.env.NODE_ENV === 'production'

/** Read the access-token cookie. Returns undefined when not present. */
export function readAccessTokenCookie(): string | undefined {
  return getCookie(ACCESS_TOKEN_COOKIE)
}

/** Read the refresh-token cookie. Returns undefined when not present. */
export function readRefreshTokenCookie(): string | undefined {
  return getCookie(REFRESH_TOKEN_COOKIE)
}

export interface SessionCookieTokens {
  accessToken: string
  refreshToken: string
  accessTokenExpiresAt: Date
  refreshTokenExpiresAt: Date
}

/**
 * Write both access and refresh cookies. Called after sign-in and after
 * every transparent refresh in `getAdminRequestContext()`.
 *
 * `maxAge` is derived from each token's own expiry claim so the browser
 * drops the cookies at the same moment the server would reject them —
 * saves round trips when the refresh token has fully expired.
 */
export function setSessionCookies(tokens: SessionCookieTokens): void {
  const now = Date.now()
  const accessMaxAgeSeconds = Math.max(
    0,
    Math.floor((tokens.accessTokenExpiresAt.getTime() - now) / 1000)
  )
  const refreshMaxAgeSeconds = Math.max(
    0,
    Math.floor((tokens.refreshTokenExpiresAt.getTime() - now) / 1000)
  )

  setCookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
    maxAge: accessMaxAgeSeconds,
  })

  setCookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
    maxAge: refreshMaxAgeSeconds,
  })
}

/**
 * Clear both session cookies. Called on sign-out and on any auth failure
 * during `getAdminRequestContext()` (ensures the browser does not keep
 * trying a token that the server has already rejected).
 */
export function clearSessionCookies(): void {
  setCookie(ACCESS_TOKEN_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
    maxAge: 0,
  })
  setCookie(REFRESH_TOKEN_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
    maxAge: 0,
  })
}
