/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect, useState } from 'react'

import { SignInForm } from '@byline/admin/auth/components/sign-in-form'
import { BylineAdminServicesProvider } from '@byline/admin/services'
import { getAdminConfig } from '@byline/core'
import type { LocaleCode } from '@byline/i18n'
import { I18nProvider, LanguageMenu } from '@byline/i18n/react'
import cx from 'clsx'

import { buildLocaleDefinitions } from '../../i18n/locale-definitions.js'
import { bylineAdminServices } from '../../integrations/byline-admin-services.js'
import {
  coordinateAuthAction,
  expectedSession,
  flagSessionChanged,
  observeSession,
  renewSingleFlight,
} from '../../integrations/session-coordination.js'
import { renewAdminSession } from '../../server-fns/auth/renew.js'
import { setAdminLocaleFn } from '../../server-fns/i18n/index.js'
import { SessionChangeBoundary } from './session-change-boundary.js'
import styles from './sign-in-page.module.css'

interface SignInPageProps {
  reauthenticate?: boolean
  redirectTo: string
  activeLocale: LocaleCode
  homeUrl?: string
}

/**
 * Sign-in page chrome — rendered outside the authenticated admin
 * layout (no app bar, breadcrumbs, or menu drawer). Wraps the
 * `SignInForm` from `@byline/admin` in the admin services provider so
 * the form can call `signIn` via the typed contract.
 *
 * Mounts its own `<I18nProvider>` because the layout-level provider
 * (the one that wraps the authenticated admin) doesn't apply here.
 * `<LanguageMenu>` lights up automatically when two or more interface
 * locales are configured. On change, the menu calls
 * `setAdminLocaleFn` which writes the cookie unconditionally and
 * skips the DB write on the pre-auth path (the user has no admin
 * session yet). After sign-in succeeds, the `adminSignIn` server fn
 * reconciles the cookie locale into the user's
 * `admin_users.preferred_locale` so the pre-auth choice becomes
 * sticky across devices from day one.
 *
 * Threads an optional host-owned `homeUrl` into `SignInForm` so the form's
 * action row can render a plain "Home" link beside the submit button.
 */
export function SignInPage({
  redirectTo,
  activeLocale,
  homeUrl,
  reauthenticate = false,
}: SignInPageProps) {
  const [checking, setChecking] = useState(!reauthenticate)
  const [bootstrapError, setBootstrapError] = useState(false)
  useEffect(() => {
    if (reauthenticate) return
    let active = true
    void renewSingleFlight(() =>
      coordinateAuthAction(async () => {
        const result = await renewAdminSession({
          data: { expectedSessionId: expectedSession() ?? undefined },
        })
        observeSession(result.sessionId)
      })
    )
      .then(() => {
        if (active) window.location.replace(redirectTo)
      })
      .catch((error) => {
        if (error?.code === 'ERR_SESSION_CHANGED') flagSessionChanged()
        else if (
          ![
            'ERR_UNAUTHENTICATED',
            'ERR_INVALID_TOKEN',
            'ERR_REVOKED_TOKEN',
            'ERR_ACCOUNT_DISABLED',
          ].includes(error?.code)
        )
          setBootstrapError(true)
      })
      .finally(() => {
        if (active) setChecking(false)
      })
    return () => {
      active = false
    }
  }, [redirectTo, reauthenticate])
  const { i18n } = getAdminConfig()
  const localeDefinitions = buildLocaleDefinitions(i18n.admin.locales, i18n.admin.localeDefinitions)
  const handleSetLocale = async (next: LocaleCode) => {
    await setAdminLocaleFn({ data: { locale: next } })
    window.location.reload()
  }
  const content = (
    <I18nProvider
      bundle={i18n.translations ?? {}}
      activeLocale={activeLocale}
      defaultLocale={i18n.admin.defaultLocale}
      localeDefinitions={localeDefinitions}
      setLocale={handleSetLocale}
    >
      <BylineAdminServicesProvider services={bylineAdminServices}>
        <main className={cx('byline-sign-in-page', styles.main)}>
          <noscript>JavaScript is required to sign in or renew your admin session.</noscript>
          <div className={cx('byline-sign-in-page-bar', styles.bar)}>
            <LanguageMenu />
          </div>
          <div className={cx('byline-sign-in-page-inner', styles.inner)}>
            {bootstrapError ? (
              <div role="alert">
                <p>Unable to check your session. Please try again.</p>
                <button type="button" onClick={() => window.location.reload()}>
                  Try again
                </button>
              </div>
            ) : checking ? (
              <p role="status">Checking your session…</p>
            ) : (
              <SignInForm redirectTo={redirectTo} homeUrl={homeUrl} />
            )}
          </div>
        </main>
      </BylineAdminServicesProvider>
    </I18nProvider>
  )
  return reauthenticate ? content : <SessionChangeBoundary>{content}</SessionChangeBoundary>
}
