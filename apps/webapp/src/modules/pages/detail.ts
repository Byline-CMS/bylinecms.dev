/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Public Page detail server fn.
 *
 * Reads through the shared *viewer* `BylineClient` so unpublished versions
 * stay invisible for ordinary visitors but become visible to admins who
 * have toggled preview mode (cookie + valid admin session). Populates
 * `featureImage` so the page renders without a follow-up request.
 */

import { createServerFn } from '@tanstack/react-start'

import type { ClientDocument, WithPopulated } from '@byline/client'
import {
  getViewerBylineClient,
  isPreviewActive,
} from '@byline/host-tanstack-start/integrations/byline-viewer-client'

import type { MediaFields } from '~/collections/media/schema.js'
import type { PageFields } from '~/collections/pages/schema.js'

type PageDetailFields = WithPopulated<PageFields, 'featureImage', MediaFields>

export type PageDetailResult = ClientDocument<PageDetailFields> | null

export interface PageDetailInput {
  slug: string
  locale?: string
}

export const getPageDetailFn = createServerFn({ method: 'GET' })
  .inputValidator(
    (input: PageDetailInput): PageDetailInput => ({
      slug: input.slug,
      locale: input.locale,
    })
  )
  .handler(async (ctx): Promise<PageDetailResult> => {
    const { slug, locale } = ctx.data as PageDetailInput
    const client = getViewerBylineClient()
    const preview = await isPreviewActive()

    return client.collection('pages').findByPath<PageDetailFields>(slug, {
      populate: { featureImage: '*' },
      locale,
      status: preview ? 'any' : 'published',
    })
  })
