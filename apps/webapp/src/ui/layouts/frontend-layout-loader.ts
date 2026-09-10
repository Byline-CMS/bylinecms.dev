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

import {
  type CurrentAdminUser,
  getCurrentAdminSessionSoft,
} from '@byline/host-tanstack-start/server-fns/auth'
import { getPreviewStateFn } from '@byline/host-tanstack-start/server-fns/preview'

import { routes } from '~/public'

export interface FrontendLayoutData {
  adminUser: CurrentAdminUser | null
  adminPath: string
  preview: boolean
  /**
   * True when the visitor holds an expired admin access credential with a
   * refresh credential still present. Public reads never rotate, so the
   * layout mounts `AdminSessionRecovery` to renew in the browser and re-run
   * this loader; the admin bar and preview then come back on their own.
   */
  sessionRenewable: boolean
}

export async function loadFrontendLayoutData(): Promise<FrontendLayoutData> {
  // Independent reads — resolve in parallel.
  const [session, previewState] = await Promise.all([
    getCurrentAdminSessionSoft(),
    getPreviewStateFn(),
  ])
  const { admin: adminPath } = routes
  return {
    adminUser: session.user,
    adminPath,
    preview: previewState.preview,
    sessionRenewable: session.renewable,
  }
}
