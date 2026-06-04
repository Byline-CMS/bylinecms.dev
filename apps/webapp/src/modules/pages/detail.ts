/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Public Page detail server fn — the TanStack Start boundary only.
 *
 * The actual read (Byline viewer SDK) lives in `./detail.server` and is loaded
 * with a dynamic `import()` *inside* the handler. This split is deliberate:
 *
 *   A `createServerFn` module is imported by the **client** too — the client
 *   needs the typed RPC stub to call the fn. The Start compiler strips the
 *   `.handler()` *body* from the client build but keeps every top-level
 *   `import`. So any server-only module reached by a *static* import from this
 *   file is dragged into the browser bundle — here, the Byline viewer SDK.
 *   Loading the impl through a handler-local dynamic import keeps the SDK
 *   reachable only from the server build.
 *
 * Keep this file's static imports client-safe: `createServerFn`, the
 * (client-safe) middleware, and `import type` only.
 */

import { createServerFn } from '@tanstack/react-start'

import type { ClientDocument, WithPopulated } from '@byline/client'

import type { MediaFields } from '~/collections/media/schema.js'
import type { PageFields } from '~/collections/pages/schema.js'

import { publicCacheMiddleware } from '@/middleware/public-cache'

export type PageDetailFields = WithPopulated<PageFields, 'featureImage', MediaFields>

export type PageDetailResult = ClientDocument<PageDetailFields> | null

export interface PageDetailInput {
  path: string
  lng?: string
}

export const getPageDetailFn = createServerFn({ method: 'GET' })
  .middleware([publicCacheMiddleware])
  .inputValidator(
    (input: PageDetailInput): PageDetailInput => ({
      path: input.path,
      lng: input.lng,
    })
  )
  .handler(async (ctx): Promise<PageDetailResult> => {
    const { getPageDetail } = await import('./detail.server')
    return getPageDetail(ctx.data as PageDetailInput)
  })
