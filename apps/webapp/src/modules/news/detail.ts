/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Public News detail server fn — the TanStack Start boundary only. The actual
 * read (Byline viewer SDK) lives in `./detail.server`, loaded with a dynamic
 * `import()` inside the handler so the server-only SDK never enters the client
 * bundle. See `../pages/detail` for the full rationale.
 */

import { createServerFn } from '@tanstack/react-start'

import type { ClientDocument, WithPopulated } from '@byline/client'

import type { MediaFields } from '~/collections/media/schema.js'
import type { NewsFields } from '~/collections/news/schema.js'
import type { NewsCategoryFields } from '~/collections/news-categories/schema.js'

import { publicCacheMiddleware } from '@/middleware/public-cache'

export type NewsDetailFields = WithPopulated<
  WithPopulated<NewsFields, 'category', NewsCategoryFields>,
  'featureImage',
  MediaFields
>

export type NewsDetailResult = ClientDocument<NewsDetailFields> | null

export interface NewsDetailInput {
  path: string
  lng?: string
}

export const getNewsDetailFn = createServerFn({ method: 'GET' })
  .middleware([publicCacheMiddleware])
  .inputValidator(
    (input: NewsDetailInput): NewsDetailInput => ({
      path: input.path,
      lng: input.lng,
    })
  )
  .handler(async (ctx): Promise<NewsDetailResult> => {
    const { getNewsDetail } = await import('./detail.server')
    return getNewsDetail(ctx.data as NewsDetailInput)
  })
