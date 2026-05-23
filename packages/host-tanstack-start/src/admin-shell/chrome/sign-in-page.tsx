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
import cx from 'classnames'

import { bylineAdminServices } from '../../integrations/byline-admin-services.js'
import styles from './sign-in-page.module.css'

interface SignInPageProps {
  callbackUrl?: string
}

/**
 * Sign-in page chrome — rendered outside the authenticated admin
 * layout (no app bar, breadcrumbs, or menu drawer). Wraps the
 * `SignInForm` from `@byline/ui` in the admin services provider so
 * the form can call `signIn` via the typed contract.
 *
 * Threads the configured `serverURL` into the `SignInForm` as `homeUrl` so
 * the form's action row can render a plain "Home" link beside the submit
 * button. After admin sign-out users land back here; the link is what lets
 * them get back to the public site without typing the URL.
 */
export function SignInPage({ callbackUrl }: SignInPageProps) {
  const { serverURL } = getClientConfig()
  return (
    <BylineAdminServicesProvider services={bylineAdminServices}>
      <main className={cx('byline-sign-in-page', styles.main)}>
        <div className={cx('byline-sign-in-page-inner', styles.inner)}>
          <SignInForm callbackUrl={callbackUrl} homeUrl={serverURL} />
        </div>
      </main>
    </BylineAdminServicesProvider>
  )
}
