/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Public News list server fn.
 *
 * Reads the `news` collection through the shared public `BylineClient`
 * (`actor: null`, `readMode: 'published'`) and exposes a filterable
 * query. `assertActorCanPerform` permits the null actor on read paths
 * whose `readMode === 'published'`, which is exactly the client's
 * default. The optional `category` input is matched against the related
 * news-category's `path` slug.
 */

import { createServerFn } from '@tanstack/react-start'

import type { FindResult, WithPopulated } from '@byline/client'

import { getPublicBylineClient } from '@/lib/get-byline-client'
import type { MediaFields } from '~/collections/media/schema.js'
import type { NewsFields } from '~/collections/news/schema.js'
import type { NewsCategoryFields } from '~/collections/news-categories/schema.js'

/**
 * News field shape with `category` and `featureImage` re-typed for populate.
 * Schema-derived `NewsFields` types those slots as the unpopulated wire
 * shape (`RelatedDocumentValue`); `WithPopulated` overlays the populated
 * envelope so dot-notation through `.document.fields.x` is fully checked.
 */
type NewsListFields = WithPopulated<
  WithPopulated<NewsFields, 'category', NewsCategoryFields>,
  'featureImage',
  MediaFields
>

export type NewsListResult = FindResult<NewsListFields>

export interface NewsListInput {
  category?: string
  page?: number
  pageSize?: number
  locale?: string
}

interface ResolvedNewsListInput {
  category: string | undefined
  page: number
  pageSize: number
  locale: string | undefined
}

export const getNewsListFn = createServerFn({ method: 'GET' })
  .inputValidator(
    (input: NewsListInput | undefined): ResolvedNewsListInput => ({
      category: input?.category || undefined,
      page: input?.page ?? 1,
      pageSize: input?.pageSize ?? 12,
      locale: input?.locale,
    })
  )
  .handler(async (ctx): Promise<NewsListResult> => {
    const data = ctx.data as ResolvedNewsListInput
    const client = getPublicBylineClient()

    return client.collection('news').find<NewsListFields>({
      where: data.category ? { category: { path: data.category } } : undefined,
      sort: { publishedOn: 'desc' },
      depth: 1,
      populate: { category: '*', featureImage: '*' },
      page: data.page,
      pageSize: data.pageSize,
      locale: data.locale,
    })
  })
