/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Per-collection sitemap getter for `docs`. See `news/sitemap.ts` for the
 * shared shape; docs are ordered by their fractional-index `orderKey`.
 *
 * Uses the *public* client (never the viewer client): sitemaps are
 * anonymous, cacheable endpoints where editor preview must never apply —
 * see the contract in `@byline/host-tanstack-start`'s viewer-client header.
 */

import { getPublicBylineClient } from '@byline/host-tanstack-start/integrations/byline-public-client'

import type { DocFields } from '~/collections/docs/schema.js'

import { advertisedLocalesFor } from '@/lib/alternates'
import { cacheKeys, tags, withCache } from '@/lib/cache/with-cache'
import { type SitemapEntry, toSitemapDate } from '@/lib/sitemap'

/** Sitemaps change infrequently; cache the full scan for an hour. */
const SITEMAP_TTL_MS = 60 * 60 * 1000

export async function getDocsSitemap(): Promise<SitemapEntry[]> {
  // L1 cache: the sitemap is a full-collection scan, so it benefits most from
  // caching. Tagged with the collection tag so any create / publish / delete
  // sweeps it. No preview notion — sitemaps are always the published view.
  return withCache<SitemapEntry[]>({
    cacheKey: cacheKeys.sitemap('docs'),
    tags: [tags.collection('docs'), tags.sitemap('docs')],
    ttl: SITEMAP_TTL_MS,
    fn: async () => {
      const client = getPublicBylineClient()
      const result = await client.collection('docs').find<DocFields>({
        select: ['publishedOn'],
        status: 'published',
        sort: { orderKey: 'asc' },
        pageSize: 10_000,
      })

      return result.docs.map((doc) => ({
        segments: ['docs', doc.path],
        lastmod: toSitemapDate(doc.fields.publishedOn ?? doc.updatedAt),
        advertisedLocales: advertisedLocalesFor(doc),
      }))
    },
  })
}
