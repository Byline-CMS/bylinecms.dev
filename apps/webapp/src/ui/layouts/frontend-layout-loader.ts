/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Shared loader for the public frontend layout. The
 * `$lng/_frontend/route.tsx` layout calls this so the layout's data
 * fetches live in one place.
 */

import { resolveRoutes } from '@byline/core'
import {
  type CurrentAdminUser,
  getCurrentAdminUserSoft,
} from '@byline/host-tanstack-start/server-fns/auth'
import { getPreviewStateFn } from '@byline/host-tanstack-start/server-fns/preview'

import { routes as bylineRoutes } from '~/routes'

export interface FrontendLayoutData {
  adminUser: CurrentAdminUser | null
  adminPath: string
  preview: boolean
}

export async function loadFrontendLayoutData(): Promise<FrontendLayoutData> {
  // Independent reads — resolve in parallel.
  const [adminUser, previewState] = await Promise.all([
    getCurrentAdminUserSoft(),
    getPreviewStateFn(),
  ])
  const { admin: adminPath } = resolveRoutes(bylineRoutes)
  return { adminUser, adminPath, preview: previewState.preview }
}
