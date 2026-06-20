/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-only implementation of the Doc detail read. Loaded via a dynamic
 * `import()` from `./details` so the Byline viewer SDK never enters the client
 * bundle — see the boundary note in `../pages/details`.
 *
 * Reads through the shared *viewer* `BylineClient` so unpublished versions stay
 * invisible for ordinary visitors but become visible to admins who have toggled
 * preview mode (cookie + valid admin session). Populates `featureImage` so the
 * page renders without a follow-up request.
 *
 * `docs` is a `tree: true` collection: the read leaf-resolves the splat,
 * derives the ancestor chain, and (for non-preview reads) enforces an unbroken
 * published spine — see `./resolve.server`. Preview reads see the full tree
 * (`status: 'any'`, no spine enforcement).
 */

import {
  getViewerBylineClient,
  isPreviewActive,
} from '@byline/host-tanstack-start/integrations/byline-viewer-client'

import { resolveDocTreeBySplat } from './resolve.server'
import type { DocDetailsFields, DocSplatInput, DocSplatResult } from './details'

export async function getDocBySplat({ splat, lng }: DocSplatInput): Promise<DocSplatResult> {
  const client = getViewerBylineClient()
  const preview = await isPreviewActive()

  return resolveDocTreeBySplat<DocDetailsFields>(client.collection('docs'), {
    splat,
    locale: lng,
    status: preview ? 'any' : 'published',
    enforceSpine: !preview,
    populate: { featureImage: '*', photo: '*' },
  })
}
