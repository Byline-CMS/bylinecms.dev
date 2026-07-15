/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { getClientConfig, resolveRoutes } from '@byline/core'

/** Read the canonical client-safe sign-in destination. */
export function getSignInRoutePath(): string {
  return getClientConfig().routes.signIn
}

/** @deprecated Configure `routes.signIn`; retained for route-factory input validation. */
export function configureSignInRoutePath(legacyOverride?: string): string {
  const routes = getClientConfig().routes
  const configured = routes.signIn
  if (legacyOverride === undefined) return configured

  const normalizedOverride = resolveRoutes({ ...routes, signIn: legacyOverride }).signIn
  if (normalizedOverride !== configured) {
    throw new Error(
      `createAdminLayoutRoute signInPath (${normalizedOverride}) must match routes.signIn (${configured})`
    )
  }
  return configured
}

/** Defer deprecated override validation until the admin route's beforeLoad boundary. */
export function createSignInRoutePathResolver(legacyOverride?: string): () => string {
  return legacyOverride === undefined
    ? getSignInRoutePath
    : () => configureSignInRoutePath(legacyOverride)
}
