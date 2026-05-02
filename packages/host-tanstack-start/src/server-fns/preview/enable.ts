/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Enable front-end preview mode for the current admin session.
 *
 * Resolves an admin `RequestContext` first — `getAdminRequestContext`
 * throws `ERR_UNAUTHENTICATED` for non-admin callers, so the cookie is
 * only ever issued to a valid admin. Once set, the viewer client picks
 * the cookie up on subsequent requests and elevates the read context.
 */

import { createServerFn } from '@tanstack/react-start'

import { getAdminRequestContext } from '../../auth/auth-context.js'
import { setPreviewCookie } from '../../auth/preview-cookies.js'

export const enablePreviewModeFn = createServerFn({ method: 'POST' }).handler(async () => {
  await getAdminRequestContext()
  setPreviewCookie()
  return { status: 'ok' as const, preview: true as const }
})
