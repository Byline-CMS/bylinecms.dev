/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react'

import {
  acceptSession,
  expectedSession,
  flagSessionChanged,
  observeSession,
  sessionEpoch,
  sessionIsChanged,
  startSessionNotifications,
  subscribeSessionChange,
} from '../../integrations/session-coordination.js'
import { getSignInRoutePath } from '../../routes/sign-in-path.js'
import { type CurrentAdminUser, getCurrentAdminUser } from '../../server-fns/auth/current-user.js'

/** Blocks the page until the user explicitly acknowledges freshly verified login identity. */
export function SessionChangeBoundary({
  user,
  children,
}: {
  user?: CurrentAdminUser
  children: ReactNode
}) {
  const epoch = useSyncExternalStore(subscribeSessionChange, sessionEpoch, () => 0)
  const changed = sessionIsChanged()
  const [current, setCurrent] = useState(user)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const mismatch =
    typeof window !== 'undefined' &&
    !!user &&
    !!expectedSession() &&
    expectedSession() !== user.sessionId
  useEffect(() => {
    startSessionNotifications()
    if (user) {
      try {
        observeSession(user.sessionId)
      } catch {
        /* Interstitial owns this mismatch. */
      }
    }
  }, [user])
  useEffect(() => {
    if (!changed && !mismatch) return
    void getCurrentAdminUser()
      .then((verified) => {
        if (sessionEpoch() !== epoch) return
        setCurrent(verified)
        setError(undefined)
      })
      .catch(() => setError('The session is no longer available. Please sign in again.'))
  }, [changed, mismatch, epoch])
  if (!changed && !mismatch) return children
  async function acknowledge() {
    setBusy(true)
    try {
      const verified = await getCurrentAdminUser()
      // Require a second acknowledgement if the identity changed while this interstitial was open.
      if (!current || current.sessionId !== verified.sessionId) {
        setCurrent(verified)
        setError('The active session changed again. Review the account before continuing.')
        return
      }
      acceptSession(verified.sessionId)
      window.location.reload() // Discard queued edits and old page state; never replay them.
    } catch {
      flagSessionChanged()
      setError('Unable to verify the active session. Please sign in again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <main role="alertdialog" aria-modal="true" aria-labelledby="session-change-title">
      <h1 id="session-change-title">Your session has changed</h1>
      <p>Your previous work has not been retried. Check the active account before continuing.</p>
      {current && <p>Active account: {current.email}</p>}
      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={busy || !current} onClick={acknowledge}>
        Continue as this account
      </button>
      <a href={`${getSignInRoutePath()}?reauthenticate=1`}>Sign in again</a>
    </main>
  )
}
