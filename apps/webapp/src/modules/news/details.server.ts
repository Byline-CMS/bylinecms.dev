/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-only implementation of the News detail read. Loaded via a dynamic
 * `import()` from `./details` so the Byline viewer SDK never enters the client
 * bundle — see the boundary note in `../pages/details`.
 *
 * Reads through the shared *viewer* `BylineClient` so unpublished versions stay
 * invisible for ordinary visitors but become visible to admins who have toggled
 * preview mode (cookie + valid admin session). Populates `category` +
 * `featureImage` so the page renders without a follow-up request.
 */

import {
  getViewerBylineClient,
  isPreviewActive,
} from '@byline/host-tanstack-start/integrations/byline-viewer-client'

import type { NewsDetailsFields, NewsDetailsInput, NewsDetailsResult } from './details'

export async function getNewsDetails({ path, lng }: NewsDetailsInput): Promise<NewsDetailsResult> {
  const client = getViewerBylineClient()
  const preview = await isPreviewActive()

  return client.collection('news').findByPath<NewsDetailsFields>(path, {
    populate: { category: '*', featureImage: '*' },
    locale: lng,
    status: preview ? 'any' : 'published',
  })
}
