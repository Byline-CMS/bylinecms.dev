/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Public Docs search server fn — the TanStack Start boundary only. The actual
 * ranked read (Byline viewer SDK `collection('docs').search`) lives in
 * `./search.server`, loaded with a dynamic `import()` inside the handler so the
 * server-only SDK never enters the client bundle. Mirrors `./nav`.
 *
 * Returns the lightweight hit tier (title, canonical URL chain, highlighted
 * snippet) — enough to render a results list. Published-only, since the search
 * index holds only published documents.
 */

import { createServerFn } from '@tanstack/react-start'

import { publicCacheMiddleware } from '@/middleware/public-cache'

/** One rendered docs search result. */
export interface DocSearchHit {
  id: string
  title: string
  /** Canonical URL segments after `/docs/`, e.g. `['getting-started', 'cli']`. */
  chain: string[]
  /**
   * Matched snippet — plain text with `<mark>…</mark>` around the matched
   * terms (rendered safely, not as raw HTML — see the route's `Highlighted`).
   */
  snippet?: string
  score: number
}

export interface DocsSearchInput {
  query: string
  lng?: string
}

export interface DocsSearchResult {
  /** The (trimmed) query that produced these hits. */
  query: string
  total: number
  hits: DocSearchHit[]
}

export const searchDocsFn = createServerFn({ method: 'GET' })
  .middleware([publicCacheMiddleware])
  .validator(
    (input: DocsSearchInput | undefined): DocsSearchInput => ({
      query: input?.query ?? '',
      lng: input?.lng,
    })
  )
  .handler(async (ctx): Promise<DocsSearchResult> => {
    const { searchDocs } = await import('./search.server')
    return searchDocs(ctx.data as DocsSearchInput)
  })
