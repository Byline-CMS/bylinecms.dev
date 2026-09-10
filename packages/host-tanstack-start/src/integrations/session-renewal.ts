/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Browser-side session renewal shared by every navigation-time caller: the
 * admin layout guard (client-side navigation after access expiry) and the
 * sign-in page bootstrap (server-rendered navigation after access expiry).
 *
 * Runs the CSRF-protected renewal server fn once per page (same-tab
 * single-flight), inside the cross-tab auth-action queue, carrying the page's
 * expected login so renewal can never silently adopt another tab's account.
 * A reported or observed login change flags the session-change interstitial
 * and rejects; callers must not treat that as a retryable outcome.
 *
 * Business-operation renewal lives in `session-middleware.ts`; it captures a
 * per-operation snapshot and resends, which this navigation helper does not.
 */

import { renewAdminSession } from '../server-fns/auth/renew.js'
import {
  coordinateAuthAction,
  expectedSession,
  flagSessionChanged,
  observeSession,
  renewSingleFlight,
} from './session-coordination.js'

export function renewExpectedSession(): Promise<void> {
  return renewSingleFlight(() =>
    coordinateAuthAction(async () => {
      const result = await renewAdminSession({
        data: { expectedSessionId: expectedSession() ?? undefined },
      }).catch((error) => {
        if (error?.code === 'ERR_SESSION_CHANGED') flagSessionChanged()
        throw error
      })
      observeSession(result.sessionId)
    })
  )
}
