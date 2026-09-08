/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Verification-only request context. Renewal belongs to the explicit host endpoint.
 *
 * oncePerRequest preserves the same context, actor snapshot, and requestId for
 * every call in one logical request. The read-authorization layer binds each
 * ReadContext to one authority token including requestId. Generating a new id
 * per call would make nested reads sharing a ReadContext throw:
 * "ReadContext cannot be reused across request authorities".
 */
import { ERR_ACCESS_EXPIRED, ERR_UNAUTHENTICATED, type RequestContext } from '@byline/auth'
import { getServerConfig } from '@byline/core'
import { v7 as uuidv7 } from 'uuid'

import { oncePerRequest } from './request-scope.js'
import { readAccessTokenCookie, readRefreshTokenCookie } from './session-cookies.js'

export function getAdminRequestContext(): Promise<RequestContext> {
  return oncePerRequest('byline:admin-request-context', async () => {
    const provider = getServerConfig().sessionProvider
    if (!provider) throw new Error('no sessionProvider configured')
    const access = readAccessTokenCookie()
    if (!access) {
      if (readRefreshTokenCookie())
        throw ERR_ACCESS_EXPIRED({ message: 'access credential absent; explicit renewal required' })
      throw ERR_UNAUTHENTICATED({ message: 'no admin session' })
    }
    const { actor, sessionId } = await provider.verifyAccessToken(access)
    if (!sessionId) throw new Error('session provider omitted login identity')
    return { actor, sessionId, requestId: uuidv7(), readMode: 'any' }
  })
}
