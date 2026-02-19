'use client'

/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { Breadcrumbs } from '@/context/breadcrumbs/breadcrumbs'
import { useBreadcrumbs } from '@/context/breadcrumbs/breadcrumbs-provider'
import { Branding } from './branding'

export function AppBar() {
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
