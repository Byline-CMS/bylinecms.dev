/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react'

import { useTranslation } from '@byline/i18n/react'
import { Button } from '@byline/ui/react'
import cx from 'clsx'

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
import { OptionalI18nProvider } from './optional-i18n-provider.js'
import styles from './session-change-boundary.module.css'

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
      .catch(() => setError('sessionChange.errors.unavailable'))
  }, [changed, mismatch, epoch])
  if (!changed && !mismatch) return children
  async function acknowledge() {
    setBusy(true)
    try {
      const verified = await getCurrentAdminUser()
      // Require a second acknowledgement if the identity changed while this interstitial was open.
      if (!current || current.sessionId !== verified.sessionId) {
        setCurrent(verified)
        setError('sessionChange.errors.changedAgain')
        return
      }
      acceptSession(verified.sessionId)
      window.location.reload() // Discard queued edits and old page state; never replay them.
    } catch {
      flagSessionChanged()
      setError('sessionChange.errors.unverifiable')
    } finally {
      setBusy(false)
    }
  }
  return (
    <OptionalI18nProvider>
      <SessionChangeInterstitial
        current={current}
        errorKey={error}
        busy={busy}
        onAcknowledge={acknowledge}
      />
    </OptionalI18nProvider>
  )
}

/**
 * Presentation half. Split out so the error state can be carried as a
 * translation *key* through the logic above and resolved here, inside the
 * provider — the boundary itself renders outside any `<I18nProvider>` at
 * both of its mount sites.
 */
function SessionChangeInterstitial({
  current,
  errorKey,
  busy,
  onAcknowledge,
}: {
  current?: CurrentAdminUser
  errorKey?: string
  busy: boolean
  onAcknowledge: () => void
}) {
  const { t } = useTranslation('byline-admin')
  return (
    <main
      className={cx('byline-session-change', styles.main)}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-change-title"
    >
      <div className={cx('byline-session-change-card', styles.card)}>
        <h1 id="session-change-title" className={cx('byline-session-change-title', styles.title)}>
          {t('sessionChange.title')}
        </h1>
        <p className={cx('byline-session-change-body', styles.body)}>{t('sessionChange.body')}</p>
        {current && (
          <p className={cx('byline-session-change-account', styles.account)}>
            {t('sessionChange.activeAccount', { email: current.email })}
          </p>
        )}
        {errorKey && (
          <p className={cx('byline-session-change-error', styles.error)} role="alert">
            {t(errorKey)}
          </p>
        )}
        <div className={cx('byline-session-change-actions', styles.actions)}>
          <Button type="button" disabled={busy || !current} onClick={onAcknowledge}>
            {t('sessionChange.continue')}
          </Button>
          <Button
            variant="outlined"
            intent="noeffect"
            render={<a href={`${getSignInRoutePath()}?reauthenticate=1`} />}
          >
            {t('sessionChange.signInAgain')}
          </Button>
        </div>
      </div>
    </main>
  )
}
