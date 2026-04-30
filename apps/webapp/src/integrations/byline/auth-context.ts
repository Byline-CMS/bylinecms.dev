/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Request-scoped auth context for admin server functions.
 *
 * Reads the session cookies, verifies the access token, transparently
 * refreshes when needed, and returns a `RequestContext` carrying the
 * authenticated `AdminAuth`. Every admin server fn calls this as its
 * first step — it is the single point where the admin transport boundary
 * meets the actor/ability machinery.
 *
 * Flow, in order:
 *
 *   1. Read the access cookie.
 *   2. If present, try `sessionProvider.verifyAccessToken`. On success,
 *      return the context — no DB write, no cookie churn.
 *   3. On verify failure (or missing access cookie), read the refresh
 *      cookie. If present, call `sessionProvider.refreshSession` — this
 *      rotates the refresh token atomically and issues a new access
 *      token. Write both fresh cookies to the response.
 *   4. Verify the new access token (populate the actor) and return the
 *      context.
 *   5. Any failure along the way clears both cookies so the browser
 *      stops sending a session the server has already rejected, and
 *      throws `ERR_UNAUTHENTICATED`.
 *
 * Burns a refresh-token rotation only when the access token actually
 * fails verification — not on every request. The "one session" UX is
 * the consequence of this helper working invisibly behind each call.
 */

import { ERR_UNAUTHENTICATED, type RequestContext } from '@byline/auth'
import { getServerConfig } from '@byline/core'
import { v7 as uuidv7 } from 'uuid'

import {
  clearSessionCookies,
  readAccessTokenCookie,
  readRefreshTokenCookie,
  setSessionCookies,
} from './auth-cookies.js'

function requireSessionProvider() {
  const provider = getServerConfig().sessionProvider
  if (!provider) {
    throw new Error(
      'No sessionProvider configured on ServerConfig. ' +
        'Construct a JwtSessionProvider in byline.server.config.ts and pass it to initBylineCore().'
    )
  }
  return provider
}

export async function getAdminRequestContext(): Promise<RequestContext> {
  const provider = requireSessionProvider()

  const accessToken = readAccessTokenCookie()

  // Happy path: valid access token.
  if (accessToken) {
    try {
      const { actor } = await provider.verifyAccessToken(accessToken)
      return {
        actor,
        requestId: uuidv7(),
        readMode: 'any',
      }
    } catch {
      // Fall through to refresh — we'll burn a rotation only when the
      // access token genuinely can't verify.
    }
  }

  // Refresh path: swap the refresh cookie for a fresh token pair.
  const refreshToken = readRefreshTokenCookie()
  if (!refreshToken) {
    // No session at all — clear anything stale and reject.
    clearSessionCookies()
    throw ERR_UNAUTHENTICATED({ message: 'no admin session' })
  }

  let refreshed: Awaited<ReturnType<typeof provider.refreshSession>>
  try {
    refreshed = await provider.refreshSession({ refreshToken })
  } catch (err) {
    clearSessionCookies()
    throw ERR_UNAUTHENTICATED({
      message: 'admin session could not be refreshed',
      cause: err,
    })
  }

  // Write the new cookies so subsequent requests skip the refresh path.
  setSessionCookies(refreshed)

  // Verify the freshly-minted access token to extract the actor.
  let verified: Awaited<ReturnType<typeof provider.verifyAccessToken>>
  try {
    verified = await provider.verifyAccessToken(refreshed.accessToken)
  } catch (err) {
    clearSessionCookies()
    throw ERR_UNAUTHENTICATED({
      message: 'refreshed access token did not verify',
      cause: err,
    })
  }

  return {
    actor: verified.actor,
    requestId: uuidv7(),
    readMode: 'any',
  }
}
