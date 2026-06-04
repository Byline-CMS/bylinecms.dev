/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-only implementation of the Doc detail read. Loaded via a dynamic
 * `import()` from `./detail` so the Byline viewer SDK never enters the client
 * bundle — see the boundary note in `../pages/detail`.
 *
 * Reads through the shared *viewer* `BylineClient` so unpublished versions stay
 * invisible for ordinary visitors but become visible to admins who have toggled
 * preview mode (cookie + valid admin session). Populates `featureImage` so the
 * page renders without a follow-up request.
 */

import {
  getViewerBylineClient,
  isPreviewActive,
} from '@byline/host-tanstack-start/integrations/byline-viewer-client'

import type { DocDetailFields, DocDetailInput, DocDetailResult } from './detail'

export async function getDocDetail({ path, lng }: DocDetailInput): Promise<DocDetailResult> {
  const client = getViewerBylineClient()
  const preview = await isPreviewActive()

  return client.collection('docs').findByPath<DocDetailFields>(path, {
    populate: { featureImage: '*', photo: '*' },
    locale: lng,
    status: preview ? 'any' : 'published',
  })
}
