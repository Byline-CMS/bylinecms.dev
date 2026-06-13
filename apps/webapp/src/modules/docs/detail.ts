/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Public Doc detail server fn — the TanStack Start boundary only. The actual
 * read (Byline viewer SDK) lives in `./detail.server`, loaded with a dynamic
 * `import()` inside the handler so the server-only SDK never enters the client
 * bundle. See `../pages/detail` for the full rationale.
 */

import { createServerFn } from '@tanstack/react-start'

import type { ClientDocument, WithPopulated } from '@byline/client'

import type { DocFields } from '~/collections/docs/schema.js'
import type { MediaFields } from '~/collections/media/schema.js'

import { publicCacheMiddleware } from '@/middleware/public-cache'

export type DocDetailFields = WithPopulated<DocFields, 'featureImage', MediaFields>

export type DocDetailResult = ClientDocument<DocDetailFields> | null

export interface DocDetailInput {
  path: string
  lng?: string
}

export const getDocDetailFn = createServerFn({ method: 'GET' })
  .middleware([publicCacheMiddleware])
  .validator(
    (input: DocDetailInput): DocDetailInput => ({
      path: input.path,
      lng: input.lng,
    })
  )
  .handler(async (ctx): Promise<DocDetailResult> => {
    const { getDocDetail } = await import('./detail.server')
    return getDocDetail(ctx.data as DocDetailInput)
  })
