/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Public Doc detail server fn.
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

import type { DocFields } from '~/collections/docs/schema.js'
import type { MediaFields } from '~/collections/media/schema.js'

import { publicCacheMiddleware } from '@/middleware/public-cache'

type DocDetailFields = WithPopulated<DocFields, 'featureImage', MediaFields>

export type DocDetailResult = ClientDocument<DocDetailFields> | null

export interface DocDetailInput {
  path: string
  lng?: string
}

export const getDocDetailFn = createServerFn({ method: 'GET' })
  .middleware([publicCacheMiddleware])
  .inputValidator(
    (input: DocDetailInput): DocDetailInput => ({
      path: input.path,
      lng: input.lng,
    })
  )
  .handler(async (ctx): Promise<DocDetailResult> => {
    const { path, lng } = ctx.data as DocDetailInput
    const client = getViewerBylineClient()
    const preview = await isPreviewActive()

    return client.collection('docs').findByPath<DocDetailFields>(path, {
      populate: { featureImage: '*' },
      locale: lng,
      status: preview ? 'any' : 'published',
    })
  })
