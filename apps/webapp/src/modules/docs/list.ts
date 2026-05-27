/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Public Docs list server fn.
 *
 * Returns published docs ordered by the collection's fractional-index
 * `orderKey` ascending (matches `orderable: true` semantics on the
 * `Docs` schema). Routes through the shared *viewer* `BylineClient` so
 * preview mode surfaces unpublished versions for signed-in admins.
 *
 * Narrow projection — only `title` is selected (id/path/status/timestamps
 * are always present on ClientDocument). This keeps the docs table-of-
 * contents payload tiny; the index and `$path` routes fetch the full
 * document via `getDocDetailFn` for the body render.
 */

import { createServerFn } from '@tanstack/react-start'

import type { ClientDocument, FindResult } from '@byline/client'
import {
  getViewerBylineClient,
  isPreviewActive,
} from '@byline/host-tanstack-start/integrations/byline-viewer-client'

import type { DocFields } from '~/collections/docs/schema.js'

import { publicCacheMiddleware } from '@/middleware/public-cache'

type DocListFields = Pick<DocFields, 'title' | 'summary'>

export type DocListItem = ClientDocument<DocListFields>
export type DocListResult = FindResult<DocListFields>

export interface DocListInput {
  lng?: string
}

export const getDocsListFn = createServerFn({ method: 'GET' })
  .middleware([publicCacheMiddleware])
  .inputValidator(
    (input: DocListInput | undefined): DocListInput => ({
      lng: input?.lng,
    })
  )
  .handler(async (ctx): Promise<DocListResult> => {
    const { lng } = ctx.data as DocListInput
    const client = getViewerBylineClient()
    const preview = await isPreviewActive()

    return client.collection('docs').find<DocListFields>({
      select: ['title', 'summary'],
      locale: lng,
      status: preview ? 'any' : 'published',
      sort: { orderKey: 'asc' },
      pageSize: 10_000,
    })
  })
