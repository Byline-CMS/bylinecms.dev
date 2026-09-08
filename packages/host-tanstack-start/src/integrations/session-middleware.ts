/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createMiddleware } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'

import {
  AuthError,
  ERR_ACCESS_EXPIRED,
  ERR_SESSION_CHANGED,
  ERR_UNAUTHENTICATED,
} from '@byline/auth'
import { getAdminRequestContext } from '@byline/client/server'

import { renewAdminSession } from '../server-fns/auth/renew.js'
import {
  coordinateAuthAction,
  flagSessionChanged,
  observeSession,
  renewSingleFlight,
  requireUnchanged,
  sessionSnapshot,
} from './session-coordination.js'
import { sessionRequestKind } from './session-request-kind.js'

const outcomeHeader = 'x-byline-auth-boundary'
/** The boundary owns the retry signal; handler errors cannot turn into retryable outcomes. */
export const adminSessionMiddleware = createMiddleware({ type: 'function' })
  .client(async ({ next }) => {
    if (typeof window === 'undefined')
      return next({ sendContext: { bylineExpectedSessionId: null as string | null } })
    const snapshot = sessionSnapshot()
    requireUnchanged(snapshot)
    return next({
      sendContext: { bylineExpectedSessionId: snapshot.sessionId },
      fetch: async (input, init) => {
        // Re-serialize reusable BodyInit values (including FormData/Blob) on retry.
        // Never clone/tee a Request: an unread branch can buffer an entire upload.
        const reusable = !(input instanceof Request) && !(init?.body instanceof ReadableStream)
        let response = await fetch(input, init)
        if (response.headers.get(outcomeHeader) === 'changed') {
          flagSessionChanged()
          throw ERR_SESSION_CHANGED({ message: 'session changed' })
        }
        if (response.headers.get(outcomeHeader) === 'renew') {
          requireUnchanged(snapshot)
          await renewSingleFlight(() =>
            coordinateAuthAction(async () => {
              const result = await renewAdminSession({
                data: { expectedSessionId: snapshot.sessionId ?? undefined },
              }).catch((error) => {
                if (error?.code === 'ERR_SESSION_CHANGED') flagSessionChanged()
                throw error
              })
              if (snapshot.sessionId && result.sessionId !== snapshot.sessionId) {
                flagSessionChanged()
                throw ERR_SESSION_CHANGED({ message: 'session changed during renewal' })
              }
              observeSession(result.sessionId)
            })
          )
          requireUnchanged(snapshot)
          if (!reusable)
            throw ERR_ACCESS_EXPIRED({ message: 'Session renewed. Please retry the operation.' })
          response = await fetch(input, init)
          if (response.headers.get(outcomeHeader) === 'changed') flagSessionChanged()
        }
        requireUnchanged(snapshot)
        return response
      },
    })
  })
  .server(async ({ next, context, method }) => {
    const kind = sessionRequestKind(getRequest())
    if (!kind) throw new Error('sessionRequestMiddleware is not configured')
    let auth: Awaited<ReturnType<typeof getAdminRequestContext>>
    try {
      auth = await getAdminRequestContext()
    } catch (error) {
      if (error instanceof AuthError && error.code === 'ERR_ACCESS_EXPIRED')
        setResponseHeader(outcomeHeader, 'renew')
      throw error
    }
    const expected = context.bylineExpectedSessionId
    if ((kind === 'serverFn' || method !== 'GET') && (!expected || expected !== auth.sessionId)) {
      setResponseHeader(outcomeHeader, 'changed')
      throw ERR_SESSION_CHANGED({ message: 'session changed before operation' })
    }
    if (!auth.sessionId) throw ERR_UNAUTHENTICATED({ message: 'provider omitted login identity' })
    // Strip the reserved signal after any handler outcome, including exceptions.
    try {
      const result = await next()
      const response = (result as { result?: unknown }).result
      if (response instanceof Response) response.headers.delete(outcomeHeader)
      return result
    } catch (error) {
      if (error instanceof Response) error.headers.delete(outcomeHeader)
      throw error
    } finally {
      setResponseHeader(outcomeHeader, 'handled')
    }
  })
