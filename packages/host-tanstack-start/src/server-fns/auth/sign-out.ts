/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Admin sign-out server function.
 *
 * Revokes the current refresh token (so a stolen copy cannot be reused),
 * clears both session cookies, and clears the preview-mode cookie.
 * Idempotent — if the caller already lacks a refresh cookie, we still
 * clear whatever's there and return successfully.
 *
 * Note: clearing `byline_preview` here is hygiene, not a security
 * requirement. The CDN cache-bypass middleware keys off the session
 * cookies, not the preview cookie, so a stale preview cookie left in the
 * browser does not affect cacheability of subsequent anonymous responses.
 * Clearing it simply means the next sign-in starts in non-preview mode.
 */

import { createServerFn } from '@tanstack/react-start'

import {
  clearPreviewCookie,
  clearSessionCookies,
  readRefreshTokenCookie,
} from '@byline/client/server'
import { getServerConfig } from '@byline/core'

export const adminSignOut = createServerFn({ method: 'POST' }).handler(async () => {
  const provider = getServerConfig().sessionProvider
  const refreshToken = readRefreshTokenCookie()

  if (provider && refreshToken) {
    // Best-effort revoke — `revokeSession` itself is idempotent for
    // unknown/already-revoked tokens, so failures here would almost
    // certainly be transport-level. Swallow and continue: the cookies
    // get cleared regardless, so the caller's session ends.
    try {
      await provider.revokeSession(refreshToken)
    } catch {
      // no-op
    }
  }

  clearSessionCookies()
  clearPreviewCookie()
  return { status: 'ok' as const }
})
