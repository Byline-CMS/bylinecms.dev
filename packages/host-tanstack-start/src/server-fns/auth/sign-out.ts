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
 * Revokes the login identified by either credential (so a stolen copy cannot be reused),
 * clears both session cookies, and clears the preview-mode cookie.
 * Idempotent — if the caller already lacks both credential cookies, we still
 * clear whatever's there and return successfully.
 *
 * Note: clearing `byline_preview` here is hygiene, not a security
 * requirement. The CDN cache-bypass middleware keys off the session
 * cookies, not the preview cookie, so a stale preview cookie left in the
 * browser does not affect cacheability of subsequent anonymous responses.
 * Clearing it simply means the next sign-in starts in non-preview mode.
 */

import { createMiddleware, createServerFn } from '@tanstack/react-start'

import { ERR_SESSION_CHANGED } from '@byline/auth'
import {
  clearPreviewCookie,
  clearSessionCookies,
  readAccessTokenCookie,
  readRefreshTokenCookie,
} from '@byline/client/server'
import { getServerConfig } from '@byline/core'

import {
  coordinateAuthAction,
  flagSessionChanged,
  notifySessionAction,
  sessionSnapshot,
} from '../../integrations/session-coordination.js'

const signOutBoundary = createMiddleware({ type: 'function' }).client(async ({ next }) => {
  const snapshot = sessionSnapshot()
  return coordinateAuthAction(async () => {
    try {
      const result = await next({ sendContext: { expectedSessionId: snapshot.sessionId } })
      notifySessionAction()
      return result
    } catch (error) {
      if ((error as { code?: string })?.code === 'ERR_SESSION_CHANGED') flagSessionChanged()
      throw error
    }
  })
})

export const adminSignOut = createServerFn({ method: 'POST' })
  .middleware([signOutBoundary])
  .handler(async ({ context }) => {
    const provider = getServerConfig().sessionProvider
    const refreshToken = readRefreshTokenCookie()
    const accessToken = readAccessTokenCookie()

    if (refreshToken || accessToken) {
      if (!provider) throw new Error('no sessionProvider configured')
      if (!context.expectedSessionId)
        throw ERR_SESSION_CHANGED({ message: 'logout requires the page login identity' })
      await provider.revokeSession({
        refreshToken,
        accessToken,
        expectedSessionId: context.expectedSessionId,
      })
    }

    clearSessionCookies()
    clearPreviewCookie()
    return { status: 'ok' as const }
  })
