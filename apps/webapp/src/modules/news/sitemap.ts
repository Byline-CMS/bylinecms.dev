/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Per-collection sitemap getter for `news`. Each getter returns plain
 * `SitemapEntry` rows — segments after the locale prefix, a W3C `lastmod`,
 * and the document's advertised-locale set for hreflang alternates. The
 * route handler (`src/routes/sitemap[.]xml.ts`) aggregates and serializes.
 *
 * Uses the *public* client (never the viewer client): sitemaps are
 * anonymous, cacheable endpoints where editor preview must never apply.
 */

import { getPublicBylineClient } from '@byline/host-tanstack-start/integrations/byline-public-client'

import type { NewsFields } from '~/collections/news/schema.js'

import { advertisedLocalesFor } from '@/lib/alternates'
import { cacheKeys, tags, withCache } from '@/lib/cache/with-cache'
import { type SitemapEntry, toSitemapDate } from '@/lib/sitemap'

/** Sitemaps change infrequently; cache the full scan for an hour. */
const SITEMAP_TTL_MS = 60 * 60 * 1000

export async function getNewsSitemap(): Promise<SitemapEntry[]> {
  // L1 cache: a full-collection scan, swept by the news collection hooks on
  // any create / publish / delete. Always the published view (no preview).
  return withCache<SitemapEntry[]>({
    cacheKey: cacheKeys.sitemap('news'),
    tags: [tags.collection('news'), tags.sitemap('news')],
    ttl: SITEMAP_TTL_MS,
    fn: async () => {
      const client = getPublicBylineClient()
      const result = await client.collection('news').find<NewsFields>({
        select: ['publishedOn'],
        status: 'published',
        sort: { publishedOn: 'desc' },
        pageSize: 10_000,
      })

      return result.docs.map((doc) => ({
        segments: ['news', doc.path],
        lastmod: toSitemapDate(doc.fields.publishedOn ?? doc.updatedAt),
        advertisedLocales: advertisedLocalesFor(doc),
      }))
    },
  })
}
