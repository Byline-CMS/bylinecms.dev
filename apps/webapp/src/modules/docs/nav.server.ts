/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-only implementation of the Docs navigation read. Loaded via a dynamic
 * `import()` from `./nav` so the Byline viewer SDK never enters the client
 * bundle — see the boundary note in `../pages/details`.
 *
 * Reads the document **tree** via `getSubtree` (pre-order, per-parent ordered)
 * through the *viewer* client, so drafts stay hidden for visitors but become
 * visible to admins in preview mode. Status-at-edge: a published parent's
 * draft-only child drops out of public nav (`getSubtree` omits it), and an
 * unpublished node hides its whole subtree — matching the splat handler's 404
 * semantics. Projects only `title` / `summary`; each node is shaped with its
 * full URL `chain` so links are canonical hierarchical URLs.
 */

import type { TreeNode } from '@byline/client'

import { getViewerBylineClient, isPreviewActive } from '~/clients.server'

import { cacheKeys, tags, withCache } from '@/lib/cache/with-cache'
import type { DocNavNode, DocsNavInput, DocsNavResult } from './nav'

interface NavFields {
  title?: string
  summary?: string
}

function toNavNode(node: TreeNode<NavFields>, parentChain: string[]): DocNavNode {
  const doc = node.document
  const chain = [...parentChain, doc.path]
  const summary = doc.fields.summary?.trim()
  return {
    id: doc.id,
    path: doc.path,
    title: doc.fields.title ?? doc.path,
    summary: summary != null && summary.length > 0 ? summary : undefined,
    chain,
    children: node.children.map((child) => toNavNode(child, chain)),
  }
}

export async function getDocsNav({ lng }: DocsNavInput): Promise<DocsNavResult> {
  const client = getViewerBylineClient()
  const preview = await isPreviewActive()

  // Cached as a collection-wide `list`-shaped read: a docs content edit
  // (invalidateDocument with `list: true`) refreshes titles, and a structural
  // `afterTreeChange` (invalidateCollection) refreshes the tree shape. Preview
  // bypasses the cache and reads the full draft tree.
  return withCache<DocsNavResult>({
    cacheKey: cacheKeys.list('docs', lng),
    tags: [tags.collection('docs'), tags.list('docs')],
    preview,
    fn: async () => {
      const forest = await client.collection('docs').getSubtree<NavFields>({
        select: ['title', 'summary'],
        locale: lng,
        status: preview ? 'any' : 'published',
      })
      return { nodes: forest.map((node) => toNavNode(node, [])) }
    },
  })
}
