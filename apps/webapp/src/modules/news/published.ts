/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Published-URL enumeration for `news` — the single scan both `sitemap.xml`
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

import { getPublicBylineClient } from '@byline/client/server'
import type { NewsFields } from '@byline/generated-types'

import { advertisedLocalesFor } from '@/lib/alternates'
import { cacheKeys, tags, withCache } from '@/lib/cache/with-cache'
import { PUBLISHED_TTL_MS, type PublishedEntry, stringOrUndefined } from '@/lib/sitemap'

type NewsPublishedFields = Pick<NewsFields, 'title' | 'summary' | 'publishedOn'>

export async function getPublishedNews(): Promise<PublishedEntry[]> {
  return withCache<PublishedEntry[]>({
    cacheKey: cacheKeys.sitemap('news'),
    tags: [tags.collection('news'), tags.sitemap('news')],
    ttl: PUBLISHED_TTL_MS,
    fn: async () => {
      const client = getPublicBylineClient()
      const result = await client.collection('news').find<NewsPublishedFields>({
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
