'use client'

import { useEffect } from 'react'

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

import { useBreadcrumbs } from './breadcrumbs-provider'
import type { Breadcrumb } from './@types'

export function BreadcrumbsClient({
  breadcrumbs,
  homeLabel = 'Home',
  homePath = '/',
}: {
  breadcrumbs: Breadcrumb[]
  homeLabel?: string
  homePath?: string
}) {
  const { setBreadcrumbs } = useBreadcrumbs()
  useEffect(() => {
    setBreadcrumbs({ homeLabel, homePath, breadcrumbs })
  }, [breadcrumbs, homeLabel, homePath, setBreadcrumbs])
  return null
}
