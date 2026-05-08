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
  path: string
  lng?: string
}

export const getPageDetailFn = createServerFn({ method: 'GET' })
  .inputValidator(
    (input: PageDetailInput): PageDetailInput => ({
      path: input.path,
      lng: input.lng,
    })
  )
  .handler(async (ctx): Promise<PageDetailResult> => {
    const { path, lng } = ctx.data as PageDetailInput
    const client = getViewerBylineClient()
    const preview = await isPreviewActive()

    return client.collection('pages').findByPath<PageDetailFields>(path, {
      populate: { featureImage: '*' },
      locale: lng,
      status: preview ? 'any' : 'published',
    })
  })
