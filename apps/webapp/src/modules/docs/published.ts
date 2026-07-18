/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Published-URL enumeration for `docs` — the single scan both `sitemap.xml`
 * and `llms.txt` consume, so the two agent-facing surfaces structurally
 * cannot drift (same scan, same cache entry, same hook-driven invalidation
 * via the sitemap tags).
 *
 * Lives in the module that owns the collection: adding a collection means
 * adding its getter here, next to the loaders and the sitemap adapter,
 * rather than growing a shared file in `lib/`.
 *
 * Always the published view through the *public* client — preview never
 * applies to anonymous, cacheable agent surfaces.
 */

import type { TreeNode } from '@byline/client'
import { getPublicBylineClient } from '@byline/client/server'
import type { DocsFields } from '@byline/generated-types'

import { advertisedLocalesFor } from '@/lib/alternates'
import { cacheKeys, tags, withCache } from '@/lib/cache/with-cache'
import { PUBLISHED_TTL_MS, type PublishedEntry, stringOrUndefined } from '@/lib/sitemap'

type DocsPublishedFields = Pick<DocsFields, 'title' | 'summary' | 'publishedOn'>

export async function getPublishedDocs(): Promise<PublishedEntry[]> {
  return withCache<PublishedEntry[]>({
    cacheKey: cacheKeys.sitemap('docs'),
    tags: [tags.collection('docs'), tags.sitemap('docs')],
    ttl: PUBLISHED_TTL_MS,
    fn: async () => {
      const client = getPublicBylineClient()
      // `docs` is a `tree: true` collection, so enumerate the published tree in
      // pre-order (the table-of-contents order) and emit **hierarchical** URLs
      // (`/docs/getting-started/cli`) rather than flat slugs. `getSubtree`
      // applies status-at-edge, so a published doc hidden behind an unpublished
      // ancestor is omitted — its hierarchical URL would 404, exactly matching
      // the public splat route.
      const forest = await client.collection('docs').getSubtree<DocsPublishedFields>({
        select: ['title', 'summary', 'publishedOn'],
        status: 'published',
      })

      const entries: PublishedEntry[] = []
      const walk = (node: TreeNode<DocsPublishedFields>, parentChain: string[]): void => {
        const doc = node.document
        const chain = [...parentChain, doc.path]
        entries.push({
          segments: ['docs', ...chain],
          title: stringOrUndefined(doc.fields.title),
          description: stringOrUndefined(doc.fields.summary),
          lastmod: doc.fields.publishedOn ?? doc.updatedAt,
          advertisedLocales: advertisedLocalesFor(doc),
        })
        for (const child of node.children) walk(child, chain)
      }
      for (const node of forest) walk(node, [])
      return entries
    },
  })
}
