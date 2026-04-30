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
 * Revokes the current refresh token (so a stolen copy cannot be reused)
 * and clears both session cookies. Idempotent — if the caller already
 * lacks a refresh cookie, we still clear whatever's there and return
 * successfully.
 */

import { createServerFn } from '@tanstack/react-start'

import { getServerConfig } from '@byline/core'

import { clearSessionCookies, readRefreshTokenCookie } from '@/integrations/byline/auth-cookies'

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
  return { status: 'ok' as const }
})
