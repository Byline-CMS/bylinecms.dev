/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { SignInForm } from '@byline/admin/auth/components/sign-in-form'
import { BylineAdminServicesProvider } from '@byline/admin/services'
import { getClientConfig } from '@byline/core'
import type { LocaleCode } from '@byline/i18n'
import { I18nProvider, LanguageMenu } from '@byline/i18n/react'
import cx from 'classnames'

import { buildLocaleDefinitions } from '../../i18n/locale-definitions.js'
import { bylineAdminServices } from '../../integrations/byline-admin-services.js'
import { setInterfaceLocaleFn } from '../../server-fns/i18n/index.js'
import styles from './sign-in-page.module.css'

interface SignInPageProps {
  callbackUrl?: string
  activeLocale: LocaleCode
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
 * `setInterfaceLocaleFn` which writes the cookie unconditionally and
 * skips the DB write on the pre-auth path (the user has no admin
 * session yet). After sign-in succeeds, the `adminSignIn` server fn
 * reconciles the cookie locale into the user's
 * `admin_users.preferred_locale` so the pre-auth choice becomes
 * sticky across devices from day one.
 *
 * Threads the configured `serverURL` into the `SignInForm` as `homeUrl` so
 * the form's action row can render a plain "Home" link beside the submit
 * button.
 */
export function SignInPage({ callbackUrl, activeLocale }: SignInPageProps) {
  const { i18n, serverURL } = getClientConfig()
  const localeDefinitions = buildLocaleDefinitions(
    i18n.interface.locales,
    i18n.interface.localeDefinitions
  )
  const handleSetLocale = async (next: LocaleCode) => {
    await setInterfaceLocaleFn({ data: { locale: next } })
    window.location.reload()
  }
  return (
    <I18nProvider
      bundle={i18n.translations ?? {}}
      activeLocale={activeLocale}
      defaultLocale={i18n.interface.defaultLocale}
      localeDefinitions={localeDefinitions}
      setLocale={handleSetLocale}
    >
      <BylineAdminServicesProvider services={bylineAdminServices}>
        <main className={cx('byline-sign-in-page', styles.main)}>
          <div className={cx('byline-sign-in-page-bar', styles.bar)}>
            <LanguageMenu />
          </div>
          <div className={cx('byline-sign-in-page-inner', styles.inner)}>
            <SignInForm callbackUrl={callbackUrl} homeUrl={serverURL} />
          </div>
        </main>
      </BylineAdminServicesProvider>
    </I18nProvider>
  )
}
