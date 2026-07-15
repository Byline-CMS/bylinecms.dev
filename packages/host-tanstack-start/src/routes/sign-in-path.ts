/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { getClientConfig, resolveRoutes } from '@byline/core'

/** Read the canonical client-safe sign-in destination. */
export function getSignInRoutePath(legacyOverride?: string): string {
  const configured = resolveRoutes(getClientConfig().routes).signIn
  if (legacyOverride !== undefined) {
    const normalizedOverride = resolveRoutes({ signIn: legacyOverride }).signIn
    if (normalizedOverride !== configured) {
      throw new Error(
        `createAdminLayoutRoute signInPath (${normalizedOverride}) must match routes.signIn (${configured})`
      )
    }
  }
  return configured
}

/** @deprecated Configure `routes.signIn` and call `getSignInRoutePath()` instead. */
export const configureSignInRoutePath = getSignInRoutePath
