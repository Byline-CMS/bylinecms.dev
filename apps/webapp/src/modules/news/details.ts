/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Public News detail server fn — the TanStack Start boundary only. The actual
 * read (Byline viewer SDK) lives in `./details.server`, loaded with a dynamic
 * `import()` inside the handler so the server-only SDK never enters the client
 * bundle. See `../pages/details` for the full rationale.
 */

import { createServerFn } from '@tanstack/react-start'

import type { ClientDocument, WithPopulated } from '@byline/client'

import type { MediaFields } from '~/collections/media/schema.js'
import type { NewsFields } from '~/collections/news/schema.js'
import type { NewsCategoryFields } from '~/collections/news-categories/schema.js'

import { publicCacheMiddleware } from '@/middleware/public-cache'

export type NewsDetailsFields = WithPopulated<
  WithPopulated<NewsFields, 'category', NewsCategoryFields>,
  'featureImage',
  MediaFields
>

export type NewsDetailsResult = ClientDocument<NewsDetailsFields> | null

export interface NewsDetailsInput {
  path: string
  lng?: string
}

export const getNewsDetailsFn = createServerFn({ method: 'GET' })
  .middleware([publicCacheMiddleware])
  .validator(
    (input: NewsDetailsInput): NewsDetailsInput => ({
      path: input.path,
      lng: input.lng,
    })
  )
  .handler(async (ctx): Promise<NewsDetailsResult> => {
    const { getNewsDetails } = await import('./details.server')
    return getNewsDetails(ctx.data as NewsDetailsInput)
  })
