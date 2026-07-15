/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Per-collection published-URL enumeration — the single source both
 * `sitemap.xml` and `llms.txt` consume, so the two agent-facing surfaces
 * structurally cannot drift (same scan, same cache entry, same
 * hook-driven invalidation via the sitemap tags).
 *
 * Each entry carries everything either surface needs: URL segments,
 * `lastmod` + advertised locales (sitemap), title + description
 * (llms.txt). One scan per collection, L1-cached for an hour, swept by
 * the collection hooks on any structural change (create / publish /
 * unpublish / delete).
 *
 * Always the published view through the *public* client — preview never
 * applies to anonymous, cacheable agent surfaces.
 */

import type { TreeNode } from '@byline/client'

import { getPublicBylineClient } from '~/client.server'
import type {
  DocsFields as DocFields,
  NewsFields,
  PagesFields as PageFields,
} from '~/generated/collection-types.js'

import { advertisedLocalesFor } from '@/lib/alternates'
import { cacheKeys, tags, withCache } from '@/lib/cache/with-cache'

/** Published-index scans change infrequently; cache for an hour. */
const INDEX_TTL_MS = 60 * 60 * 1000

export interface PublishedIndexEntry {
  /** Path segments after the locale prefix, e.g. `['news', 'my-post']`. */
  segments: string[]
  /** The document's display title (llms.txt link text). */
  title?: string
  /** Short description (llms.txt link notes). */
  description?: string
  /** Publication / update date for `<lastmod>`. */
  lastmod?: Date | string | null
  /** Advertised locale set (`availableLocales ∩ _availableVersionLocales`). */
  advertisedLocales?: string[] | null
}

type DocsIndexFields = Pick<DocFields, 'title' | 'summary' | 'publishedOn'>
type NewsIndexFields = Pick<NewsFields, 'title' | 'summary' | 'publishedOn'>
type PagesIndexFields = Pick<PageFields, 'title' | 'summary' | 'area' | 'publishedOn'>

const AREA_PREFIX: Record<string, string[]> = {
  about: ['about'],
  legal: ['legal'],
  // `root` (and anything unrecognised) → no prefix.
}

export async function getDocsIndex(): Promise<PublishedIndexEntry[]> {
  return withCache<PublishedIndexEntry[]>({
    cacheKey: cacheKeys.sitemap('docs'),
    tags: [tags.collection('docs'), tags.sitemap('docs')],
    ttl: INDEX_TTL_MS,
    fn: async () => {
      const client = getPublicBylineClient()
      // `docs` is a `tree: true` collection, so enumerate the published tree in
      // pre-order (the table-of-contents order) and emit **hierarchical** URLs
      // (`/docs/getting-started/cli`) rather than flat slugs. `getSubtree`
      // applies status-at-edge, so a published doc hidden behind an unpublished
      // ancestor is omitted — its hierarchical URL would 404, exactly matching
      // the public splat route.
      const forest = await client.collection('docs').getSubtree<DocsIndexFields>({
        select: ['title', 'summary', 'publishedOn'],
        status: 'published',
      })

      const entries: PublishedIndexEntry[] = []
      const walk = (node: TreeNode<DocsIndexFields>, parentChain: string[]): void => {
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

export async function getNewsIndex(): Promise<PublishedIndexEntry[]> {
  return withCache<PublishedIndexEntry[]>({
    cacheKey: cacheKeys.sitemap('news'),
    tags: [tags.collection('news'), tags.sitemap('news')],
    ttl: INDEX_TTL_MS,
    fn: async () => {
      const client = getPublicBylineClient()
      const result = await client.collection('news').find<NewsIndexFields>({
        select: ['title', 'summary', 'publishedOn'],
        status: 'published',
        sort: { publishedOn: 'desc' },
        pageSize: 10_000,
      })
      return result.docs.map((doc) => ({
        segments: ['news', doc.path],
        title: stringOrUndefined(doc.fields.title),
        description: stringOrUndefined(doc.fields.summary),
        lastmod: doc.fields.publishedOn ?? doc.updatedAt,
        advertisedLocales: advertisedLocalesFor(doc),
      }))
    },
  })
}

export async function getPagesIndex(): Promise<PublishedIndexEntry[]> {
  return withCache<PublishedIndexEntry[]>({
    cacheKey: cacheKeys.sitemap('pages'),
    tags: [tags.collection('pages'), tags.sitemap('pages')],
    ttl: INDEX_TTL_MS,
    fn: async () => {
      const client = getPublicBylineClient()
      const result = await client.collection('pages').find<PagesIndexFields>({
        select: ['title', 'summary', 'area', 'publishedOn'],
        status: 'published',
        pageSize: 10_000,
      })
      return result.docs.map((doc) => ({
        segments: [...(AREA_PREFIX[doc.fields.area ?? 'root'] ?? []), doc.path],
        title: stringOrUndefined(doc.fields.title),
        description: stringOrUndefined(doc.fields.summary),
        lastmod: doc.fields.publishedOn ?? doc.updatedAt,
        advertisedLocales: advertisedLocalesFor(doc),
      }))
    },
  })
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}
