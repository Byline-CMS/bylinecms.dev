/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'

import { AuthError, ERR_SESSION_CHANGED, ERR_UNAUTHENTICATED } from '@byline/auth'
import {
  readAccessTokenCookie,
  readRefreshTokenCookie,
  setSessionCookies,
} from '@byline/client/server'
import { getServerConfig } from '@byline/core'

/** Explicit renewal only. Global CSRF protection applies before this POST handler. */
export const renewAdminSession = createServerFn({ method: 'POST' })
  .validator((value: unknown): { expectedSessionId?: string } => {
    if (value == null) return {}
    if (typeof value !== 'object') throw new Error('Invalid renewal input')
    const sid = (value as { expectedSessionId?: unknown }).expectedSessionId
    if (sid !== undefined && (typeof sid !== 'string' || !sid || sid.length > 256))
      throw new Error('Invalid login identity')
    return { expectedSessionId: sid as string | undefined }
  })
  .handler(async ({ data }) => {
    setResponseHeader('Cache-Control', 'no-store')
    const provider = getServerConfig().sessionProvider
    if (!provider) throw new Error('no sessionProvider configured')
    const access = readAccessTokenCookie()
    if (access) {
      try {
        const verified = await provider.verifyAccessToken(access)
        if (data.expectedSessionId && data.expectedSessionId !== verified.sessionId)
          throw ERR_SESSION_CHANGED({ message: 'session changed' })
        return { sessionId: verified.sessionId }
      } catch (error) {
        // Invalid signature, revocation and infrastructure errors never cause renewal.
        if (!(error instanceof AuthError) || error.code !== 'ERR_ACCESS_EXPIRED') throw error
      }
    }
    const refreshToken = readRefreshTokenCookie()
    if (!refreshToken) throw ERR_UNAUTHENTICATED({ message: 'no session to renew' })
    const tokens = await provider.refreshSession({
      refreshToken,
      expectedSessionId: data.expectedSessionId,
    })
    setSessionCookies(tokens)
    return { sessionId: tokens.sessionId }
  })
