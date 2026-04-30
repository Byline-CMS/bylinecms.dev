'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useState } from 'react'

import { Button } from '@infonomic/uikit/react'
import cx from 'classnames'

import { adminSignOut, type CurrentAdminUser } from '../../server-fns/auth/index.js'
import styles from './admin-app-bar.module.css'
import { Branding } from './branding.js'
import { Breadcrumbs } from './breadcrumbs/breadcrumbs.js'
import { useBreadcrumbs } from './breadcrumbs/breadcrumbs-provider.js'

interface AdminAppBarProps {
  user: CurrentAdminUser
}

function displayNameFor(user: CurrentAdminUser): string {
  const names = [user.given_name, user.family_name].filter(
    (part): part is string => typeof part === 'string' && part.length > 0
  )
  return names.length > 0 ? names.join(' ') : user.email
}

export function AdminAppBar({ user }: AdminAppBarProps) {
  const { breadCrumbSettings } = useBreadcrumbs()
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await adminSignOut()
    } catch (err) {
      // Even on transport failure, the server-side handler clears the
      // cookies best-effort. Navigate to sign-in regardless.
      console.warn('sign-out request failed', err)
    }
    // Full-page navigation so the admin guard re-runs with cleared cookies.
    window.location.assign('/sign-in')
  }

  return (
    <header className={cx('byline-admin-app-bar', styles.header)}>
      <div className={cx('byline-admin-app-bar-left', styles.left)}>
        <Branding />
        <Breadcrumbs
          homePath={breadCrumbSettings.homePath}
          homeLabel={breadCrumbSettings.homeLabel}
          breadcrumbs={breadCrumbSettings.breadcrumbs}
        />
      </div>
      <div className={cx('byline-admin-app-bar-right', styles.right)}>
        <span className={cx('byline-admin-app-bar-user', styles.user)}>
          Signed in as{' '}
          <span className={cx('byline-admin-app-bar-user-name', styles.userName)}>
            {displayNameFor(user)}
          </span>
        </span>
        <Button size="xs" intent="secondary" onClick={handleSignOut} disabled={signingOut}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </header>
  )
}
