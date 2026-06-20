/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Public Doc detail server fn — the TanStack Start boundary only. The actual
 * read (Byline viewer SDK + tree resolution) lives in `./detail.server`, loaded
 * with a dynamic `import()` inside the handler so the server-only SDK never
 * enters the client bundle. See `../pages/detail` for the full rationale.
 *
 * `docs` is a `tree: true` collection, so the read is **splat-shaped**: the
 * loader passes the full path after `/docs/` and the server resolves the leaf,
 * derives the ancestor chain, and returns the canonical chain so the route can
 * 301 non-canonical (or 404 unreachable) URLs. See docs/DOCUMENT-TREE.md.
 */

import { createServerFn } from '@tanstack/react-start'

import type { ClientDocument, WithPopulated } from '@byline/client'

import type { DocFields } from '~/collections/docs/schema.js'
import type { MediaFields } from '~/collections/media/schema.js'

import { publicCacheMiddleware } from '@/middleware/public-cache'
import type { DocTreeResolution } from './resolve.server'

export type DocDetailFields = WithPopulated<DocFields, 'featureImage', MediaFields>

export type DocDetailResult = ClientDocument<DocDetailFields> | null

/** Full splat resolution: the document, its breadcrumb chain, and the canonical
 * path segments. `null` ⇒ leaf not found or (public) spine broken → 404. */
export type DocSplatResult = DocTreeResolution<DocDetailFields> | null

export interface DocSplatInput {
  /** The path after `/docs/`, e.g. `getting-started/cli`. */
  splat: string
  lng: string
}

export const getDocBySplatFn = createServerFn({ method: 'GET' })
  .middleware([publicCacheMiddleware])
  .validator(
    (input: DocSplatInput): DocSplatInput => ({
      splat: input.splat,
      lng: input.lng,
    })
  )
  .handler(async (ctx): Promise<DocSplatResult> => {
    const { getDocBySplat } = await import('./detail.server')
    return getDocBySplat(ctx.data as DocSplatInput)
  })
