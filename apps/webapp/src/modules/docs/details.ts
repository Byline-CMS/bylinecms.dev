/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Public Doc detail server fn — the TanStack Start boundary only. The actual
 * read (Byline viewer SDK + tree resolution) lives in `./details.server`, loaded
 * with a dynamic `import()` inside the handler so the server-only SDK never
 * enters the client bundle. See `../pages/details` for the full rationale.
 *
 * `docs` is a `tree: true` collection, so the read is **splat-shaped**: the
 * loader passes the full path after `/docs/` and the server resolves the leaf,
 * derives the ancestor chain, and returns the canonical chain so the route can
 * 301 non-canonical (or 404 unreachable) URLs. See docs/04-collections/03-document-trees.md.
 */

import { createServerFn } from '@tanstack/react-start'

import type { ClientDocument, WithPopulated } from '@byline/client'

import type { DocsFields as DocFields, MediaFields } from '~/generated/collection-types.js'

import { publicCacheMiddleware } from '@/middleware/public-cache'
import type { DocTreeResolution } from './resolve.server'

export type DocDetailsFields = WithPopulated<DocFields, 'featureImage', MediaFields>

export type DocDetailsResult = ClientDocument<DocDetailsFields> | null

/** Full splat resolution: the document, its breadcrumb chain, and the canonical
 * path segments. `null` ⇒ leaf not found or (public) spine broken → 404. */
export type DocSplatResult = DocTreeResolution<DocDetailsFields> | null

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
    const { getDocBySplat } = await import('./details.server')
    return getDocBySplat(ctx.data as DocSplatInput)
  })
