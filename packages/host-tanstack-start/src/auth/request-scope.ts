/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Per-request memoization for `RequestContext` factories.
 *
 * `RequestContext.requestId` is documented as "per logical request", and
 * the read-authorization layer binds every `ReadContext` to one immutable
 * request authority whose token includes that id. A factory that mints a
 * fresh context per call breaks both contracts as soon as two reads share
 * a `ReadContext` (the admin tree view, hook-threaded nested reads):
 * the second bind sees a different authority token and throws
 * 'ReadContext cannot be reused across request authorities'.
 *
 * Memoizing on the current Start request makes every context factory
 * request-stable. It also means at most one session verification — and at
 * most one refresh-token rotation — per request, instead of one per call.
 */

import { getRequest } from '@tanstack/react-start/server'

const requestScopes = new WeakMap<object, Map<string, Promise<unknown>>>()

/**
 * Resolve `factory` at most once per HTTP request for a given `key`. The
 * returned promise is memoized on the current Start request — rejections
 * included, since a request's cookies cannot change mid-flight and retrying
 * a failed refresh would burn a second rotation on an already-rotated
 * token. Outside the Start runtime (seed scripts, unit tests, background
 * jobs) there is no request to key on and the factory runs unmemoized.
 */
export function oncePerRequest<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const request = currentRequest()
  if (!request) return factory()

  let scope = requestScopes.get(request)
  if (!scope) {
    scope = new Map()
    requestScopes.set(request, scope)
  }

  const existing = scope.get(key)
  if (existing) return existing as Promise<T>

  const pending = factory()
  scope.set(key, pending)
  return pending
}

function currentRequest(): object | undefined {
  try {
    return getRequest()
  } catch {
    // No StartEvent in AsyncLocalStorage — running outside a request.
    return undefined
  }
}
