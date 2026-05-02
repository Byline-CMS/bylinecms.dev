/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Public News detail server fn.
 *
 * Mirrors the list-side patterns in `./list.ts`: reads through the
 * shared *viewer* `BylineClient` so unpublished versions stay invisible
 * for ordinary visitors but become visible to admins who have toggled
 * preview mode (cookie + valid admin session). Populates `category` +
 * `featureImage` so the page renders without a follow-up request.
 */

import { createServerFn } from '@tanstack/react-start'

import type { ClientDocument, WithPopulated } from '@byline/client'
import {
  getViewerBylineClient,
  isPreviewActive,
} from '@byline/host-tanstack-start/integrations/byline-viewer-client'

import type { MediaFields } from '~/collections/media/schema.js'
import type { NewsFields } from '~/collections/news/schema.js'
import type { NewsCategoryFields } from '~/collections/news-categories/schema.js'

type NewsDetailFields = WithPopulated<
  WithPopulated<NewsFields, 'category', NewsCategoryFields>,
  'featureImage',
  MediaFields
>

export type NewsDetailResult = ClientDocument<NewsDetailFields> | null

export interface NewsDetailInput {
  slug: string
  locale?: string
}

export const getNewsDetailFn = createServerFn({ method: 'GET' })
  .inputValidator(
    (input: NewsDetailInput): NewsDetailInput => ({
      slug: input.slug,
      locale: input.locale,
    })
  )
  .handler(async (ctx): Promise<NewsDetailResult> => {
    const { slug, locale } = ctx.data as NewsDetailInput
    const client = getViewerBylineClient()
    const preview = await isPreviewActive()

    return client.collection('news').findByPath<NewsDetailFields>(slug, {
      populate: { category: '*', featureImage: '*' },
      locale,
      status: preview ? 'any' : 'published',
    })
  })
