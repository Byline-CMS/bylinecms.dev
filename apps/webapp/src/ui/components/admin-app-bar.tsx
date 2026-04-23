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

import { Breadcrumbs } from '@/context/breadcrumbs/breadcrumbs'
import { useBreadcrumbs } from '@/context/breadcrumbs/breadcrumbs-provider'
import { adminSignOut, type CurrentAdminUser } from '@/modules/admin/auth'
import { Branding } from './branding'

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
    <header className="h-[45px] fixed z-50 w-full max-w-full bg-white dark:bg-canvas-800 shadow p-4 text-lg font-semibold flex items-center justify-between">
      <div className="branding-and-breadcrumbs flex items-center gap-4">
        <Branding />
        <Breadcrumbs
          homePath={breadCrumbSettings.homePath}
          homeLabel={breadCrumbSettings.homeLabel}
          breadcrumbs={breadCrumbSettings.breadcrumbs}
        />
      </div>
      <div className="flex items-center gap-4 text-sm font-normal">
        <span className="text-gray-600 dark:text-gray-300 hidden sm:inline">
          Signed in as <span className="font-semibold">{displayNameFor(user)}</span>
        </span>
        <Button size="xs" intent="secondary" onClick={handleSignOut} disabled={signingOut}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </header>
  )
}
