/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-only implementation of the News list read. Loaded via a dynamic
 * `import()` from `./list` so the Byline viewer SDK never enters the client
 * bundle — see the boundary note in `../pages/details`.
 *
 * Reads the `news` collection through the shared *viewer* `BylineClient`, which
 * behaves as the public client by default and transparently upgrades to the
 * admin actor when the `byline_preview` cookie is set **and** a valid admin
 * session resolves. `isPreviewActive()` performs the same paired check and
 * decides whether this read passes `status: 'any'` (admin sees drafts) or
 * `status: 'published'` (everyone else). The optional `category` input is
 * matched against the related news-category's `path` slug.
 */

import { getViewerBylineClient, isPreviewActive } from '~/clients.server'

import { cacheKeys, tags, withCache } from '@/lib/cache/with-cache'
import type { NewsListFields, NewsListResult, ResolvedNewsListInput } from './list'

export async function getNewsList(data: ResolvedNewsListInput): Promise<NewsListResult> {
  const client = getViewerBylineClient()
  const preview = await isPreviewActive()

  return withCache<NewsListResult>({
    cacheKey: cacheKeys.list('news', data.lng, {
      category: data.category,
      page: data.page,
      pageSize: data.pageSize,
    }),
    tags: [tags.collection('news'), tags.list('news')],
    preview,
    fn: () =>
      client.collection('news').find<NewsListFields>({
        where: data.category ? { category: { path: data.category } } : undefined,
        sort: { publishedOn: 'desc' },
        populate: { category: '*', featureImage: '*' },
        page: data.page,
        pageSize: data.pageSize,
        locale: data.lng,
        status: preview ? 'any' : 'published',
      }),
  })
}
