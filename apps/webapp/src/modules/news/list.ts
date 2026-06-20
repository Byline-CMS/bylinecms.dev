/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Public News list server fn — the TanStack Start boundary only. The actual
 * read (Byline viewer SDK) lives in `./list.server`, loaded with a dynamic
 * `import()` inside the handler so the server-only SDK never enters the client
 * bundle. See `../pages/details` for the full rationale.
 */

import { createServerFn } from '@tanstack/react-start'

import type { FindResult, WithPopulated } from '@byline/client'

import type { MediaFields } from '~/collections/media/schema.js'
import type { NewsFields } from '~/collections/news/schema.js'
import type { NewsCategoryFields } from '~/collections/news-categories/schema.js'

import { publicCacheMiddleware } from '@/middleware/public-cache'

/**
 * News field shape with `category` and `featureImage` re-typed for populate.
 * Schema-derived `NewsFields` types those slots as the unpopulated wire
 * shape (`RelatedDocumentValue`); `WithPopulated` overlays the populated
 * envelope so dot-notation through `.document.fields.x` is fully checked.
 */
export type NewsListFields = WithPopulated<
  WithPopulated<NewsFields, 'category', NewsCategoryFields>,
  'featureImage',
  MediaFields
>

export type NewsListResult = FindResult<NewsListFields>

export interface NewsListInput {
  category?: string
  page?: number
  pageSize?: number
  lng?: string
}

export interface ResolvedNewsListInput {
  category: string | undefined
  page: number
  pageSize: number
  lng: string | undefined
}

export const getNewsListFn = createServerFn({ method: 'GET' })
  .middleware([publicCacheMiddleware])
  .validator(
    (input: NewsListInput | undefined): ResolvedNewsListInput => ({
      category: input?.category || undefined,
      page: input?.page ?? 1,
      pageSize: input?.pageSize ?? 12,
      lng: input?.lng,
    })
  )
  .handler(async (ctx): Promise<NewsListResult> => {
    const { getNewsList } = await import('./list.server')
    return getNewsList(ctx.data as ResolvedNewsListInput)
  })
