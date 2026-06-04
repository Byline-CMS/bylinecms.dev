/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Public Docs list server fn — the TanStack Start boundary only. The actual
 * read (Byline viewer SDK) lives in `./list.server`, loaded with a dynamic
 * `import()` inside the handler so the server-only SDK never enters the client
 * bundle. See `../pages/detail` for the full rationale.
 */

import { createServerFn } from '@tanstack/react-start'

import type { ClientDocument, FindResult } from '@byline/client'

import type { DocFields } from '~/collections/docs/schema.js'

import { publicCacheMiddleware } from '@/middleware/public-cache'

export type DocListFields = Pick<DocFields, 'title' | 'summary'>

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
    const { getDocsList } = await import('./list.server')
    return getDocsList(ctx.data as DocListInput)
  })
