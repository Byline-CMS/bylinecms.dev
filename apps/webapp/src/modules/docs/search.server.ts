/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-only implementation of the Docs search read. Loaded via a dynamic
 * `import()` from `./search` so the Byline viewer SDK never enters the client
 * bundle — see the boundary note in `./nav.server`.
 *
 * Runs a ranked full-text query through the *viewer* client
 * (`collection('docs').search`), which delegates to the registered
 * `SearchProvider`. Published-only (the index holds nothing else). Each hit's
 * own slug is resolved to its canonical hierarchical URL by joining against the
 * (cached) docs nav tree, so result links point straight at the canonical URL
 * with no 301 hop.
 */

import { getViewerBylineClient } from '~/clients.server'

import { flattenDocNav } from './nav'
import { getDocsNav } from './nav.server'
import type { DocSearchHit, DocsSearchInput, DocsSearchResult } from './search'

/** Max results returned for a single query. */
const SEARCH_LIMIT = 30

export async function searchDocs({ query, lng }: DocsSearchInput): Promise<DocsSearchResult> {
  const trimmed = query.trim()
  if (trimmed.length === 0) return { query: trimmed, total: 0, hits: [] }

  const client = getViewerBylineClient()
  const results = await client.collection('docs').search({
    query: trimmed,
    locale: lng,
    limit: SEARCH_LIMIT,
  })

  // Resolve each hit's leaf slug to its canonical URL chain from the live tree
  // (reuses the cached nav read), so links avoid the leaf-resolve 301 hop.
  const nav = await getDocsNav({ lng })
  const chainByPath = new Map<string, string[]>()
  for (const node of flattenDocNav(nav.nodes)) chainByPath.set(node.path, node.chain)

  const hits: DocSearchHit[] = results.hits.map((hit) => {
    const path = hit.path ?? ''
    return {
      id: hit.documentId,
      title: hit.title,
      chain: chainByPath.get(path) ?? (path.length > 0 ? [path] : []),
      snippet: hit.highlights?.body?.[0],
      score: hit.score,
    }
  })

  return { query: trimmed, total: results.total, hits }
}
