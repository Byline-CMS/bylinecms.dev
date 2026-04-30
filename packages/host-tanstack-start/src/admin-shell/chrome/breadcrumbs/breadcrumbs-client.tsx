'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect } from 'react'

import { useBreadcrumbs } from './breadcrumbs-provider.js'
import type { Breadcrumb } from './@types.js'

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
