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
 * the client bundle — see the boundary note in `../pages/details`.
 *
 * Reads the `news-categories` collection through the shared *viewer*
 * `BylineClient`, mirroring the preview-aware status handling used by
 * `./list.server`. Used to populate the category filter Select on the public
 * news index page.
 */

import { getViewerBylineClient, isPreviewActive } from '~/client.server'
import type { NewsCategoriesFields as NewsCategoryFields } from '~/generated/collection-types.js'

import { cacheKeys, tags, withCache } from '@/lib/cache/with-cache'
import type { NewsCategoriesListInput, NewsCategoriesListResult } from './categories'

export async function getNewsCategories({
  lng,
}: NewsCategoriesListInput): Promise<NewsCategoriesListResult> {
  const client = getViewerBylineClient()
  const preview = await isPreviewActive()

  return withCache<NewsCategoriesListResult>({
    cacheKey: cacheKeys.list('news-categories', lng),
    tags: [tags.collection('news-categories'), tags.list('news-categories')],
    preview,
    fn: () =>
      client.collection('news-categories').find<NewsCategoryFields>({
        sort: { name: 'asc' },
        pageSize: 200,
        locale: lng,
        status: preview ? 'any' : 'published',
      }),
  })
}
