/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-only implementation of the News Categories list read. Loaded via a
 * dynamic `import()` from `./categories` so the Byline viewer SDK never enters
 * the client bundle — see the boundary note in `../pages/detail`.
 *
 * Reads the `news-categories` collection through the shared *viewer*
 * `BylineClient`, mirroring the preview-aware status handling used by
 * `./list.server`. Used to populate the category filter Select on the public
 * news index page.
 */

import {
  getViewerBylineClient,
  isPreviewActive,
} from '@byline/host-tanstack-start/integrations/byline-viewer-client'

import type { NewsCategoryFields } from '~/collections/news-categories/schema.js'

import type { NewsCategoriesListInput, NewsCategoriesListResult } from './categories'

export async function getNewsCategories({
  lng,
}: NewsCategoriesListInput): Promise<NewsCategoriesListResult> {
  const client = getViewerBylineClient()
  const preview = await isPreviewActive()

  return client.collection('news-categories').find<NewsCategoryFields>({
    sort: { name: 'asc' },
    pageSize: 200,
    locale: lng,
    status: preview ? 'any' : 'published',
  })
}
