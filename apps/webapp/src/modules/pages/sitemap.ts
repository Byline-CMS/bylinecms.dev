/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Per-collection sitemap getter for `pages`. See `news/sitemap.ts` for the
 * shared shape. Page URLs compose from the document's `area` field — the
 * same rule the frontend routes (`about/$path`, `legal/$path`, root
 * `$path`) use to mount them.
 *
 * Uses the *public* client (never the viewer client): sitemaps are
 * anonymous, cacheable endpoints where editor preview must never apply.
 */

import { getPublicBylineClient } from '@byline/host-tanstack-start/integrations/byline-public-client'

import type { PageFields } from '~/collections/pages/schema.js'

import { advertisedLocalesFor } from '@/lib/alternates'
import { cacheKeys, tags, withCache } from '@/lib/cache/with-cache'
import { type SitemapEntry, toSitemapDate } from '@/lib/sitemap'

const AREA_PREFIX: Record<string, string[]> = {
  about: ['about'],
  legal: ['legal'],
  // `root` (and anything unrecognised) → no prefix.
}

/** Sitemaps change infrequently; cache the full scan for an hour. */
const SITEMAP_TTL_MS = 60 * 60 * 1000

export async function getPagesSitemap(): Promise<SitemapEntry[]> {
  // L1 cache: a full-collection scan, swept by the pages collection hooks on
  // any create / publish / delete. Always the published view (no preview).
  return withCache<SitemapEntry[]>({
    cacheKey: cacheKeys.sitemap('pages'),
    tags: [tags.collection('pages'), tags.sitemap('pages')],
    ttl: SITEMAP_TTL_MS,
    fn: async () => {
      const client = getPublicBylineClient()
      const result = await client.collection('pages').find<PageFields>({
        select: ['area', 'publishedOn'],
        status: 'published',
        pageSize: 10_000,
      })

      return result.docs.map((doc) => ({
        segments: [...(AREA_PREFIX[doc.fields.area ?? 'root'] ?? []), doc.path],
        lastmod: toSitemapDate(doc.fields.publishedOn ?? doc.updatedAt),
        advertisedLocales: advertisedLocalesFor(doc),
      }))
    },
  })
}
