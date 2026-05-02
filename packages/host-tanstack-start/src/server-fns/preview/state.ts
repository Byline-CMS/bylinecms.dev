/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Read the front-end preview cookie state.
 *
 * The `byline_preview` cookie is httpOnly so client JS cannot read it
 * directly. This server fn is the bridge: drawer toggles, content-admin
 * bar pills, and any other UI affordance that needs to reflect the
 * cookie state calls this on mount (and after enable/disable) to stay
 * in sync.
 *
 * Intentionally does NOT verify a session — the cookie's mere presence
 * is what we report. The actual safety enforcement (admin actor required
 * before drafts surface) lives in `assertActorCanPerform` on the read
 * path, not here.
 */

import { createServerFn } from '@tanstack/react-start'

import { readPreviewCookie } from '../../auth/preview-cookies.js'

export const getPreviewStateFn = createServerFn({ method: 'GET' }).handler(async () => {
  return { preview: readPreviewCookie() }
})
