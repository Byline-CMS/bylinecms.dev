/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Disable front-end preview mode by clearing the `byline_preview` cookie.
 *
 * No auth check: clearing your own preview cookie is always safe, and
 * letting an anonymous browser drop a stale cookie is the recovery path
 * when an admin's session has already lapsed.
 */

import { createServerFn } from '@tanstack/react-start'

import { clearPreviewCookie } from '../../auth/preview-cookies.js'

export const disablePreviewModeFn = createServerFn({ method: 'POST' }).handler(async () => {
  clearPreviewCookie()
  return { status: 'ok' as const, preview: false as const }
})
