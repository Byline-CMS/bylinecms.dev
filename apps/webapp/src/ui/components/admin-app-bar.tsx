'use client'

/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { Breadcrumbs } from '@/context/breadcrumbs/breadcrumbs'
import { useBreadcrumbs } from '@/context/breadcrumbs/breadcrumbs-provider'
import { Branding } from './branding'

export function AdminAppBar() {
  const { breadCrumbSettings } = useBreadcrumbs()
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
    </header>
  )
}
