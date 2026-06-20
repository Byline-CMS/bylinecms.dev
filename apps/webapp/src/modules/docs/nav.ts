/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Public Docs navigation server fn — the TanStack Start boundary only. The
 * actual read (Byline viewer SDK `getSubtree`) lives in `./nav.server`, loaded
 * with a dynamic `import()` inside the handler so the server-only SDK never
 * enters the client bundle. See `../pages/details` for the full rationale.
 *
 * `docs` is a `tree: true` collection, so the nav is the document **tree**, in
 * tree order, rather than a flat `orderKey`-sorted list. Each node carries its
 * full URL `chain` (segments after `/docs/`) so the drawer and index can emit
 * **direct hierarchical links** with no canonical 301 hop. See
 * docs/DOCUMENT-TREE.md.
 */

import { createServerFn } from '@tanstack/react-start'

import { publicCacheMiddleware } from '@/middleware/public-cache'

/** One node in the rendered docs navigation tree (pre-shaped for the client). */
export interface DocNavNode {
  id: string
  path: string
  title: string
  summary?: string
  /** URL segments after `/docs/`, e.g. `['getting-started', 'cli']`. */
  chain: string[]
  children: DocNavNode[]
}

export interface DocsNavResult {
  nodes: DocNavNode[]
}

/**
 * Flatten the nav tree to its pre-order (depth-first) **spine** — the linear
 * reading order. Drives the index card grid, the compact icon rail, and the
 * detail page's prev/next links (a document's neighbours in the spine). Pure
 * and client-safe.
 */
export function flattenDocNav(nodes: DocNavNode[], out: DocNavNode[] = []): DocNavNode[] {
  for (const node of nodes) {
    out.push(node)
    flattenDocNav(node.children, out)
  }
  return out
}

export interface DocsNavInput {
  lng?: string
}

export const getDocsNavFn = createServerFn({ method: 'GET' })
  .middleware([publicCacheMiddleware])
  .validator(
    (input: DocsNavInput | undefined): DocsNavInput => ({
      lng: input?.lng,
    })
  )
  .handler(async (ctx): Promise<DocsNavResult> => {
    const { getDocsNav } = await import('./nav.server')
    return getDocsNav(ctx.data as DocsNavInput)
  })
