/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Published-URL enumeration for `pages` — the single scan both `sitemap.xml`
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
import type { PagesFields } from '@byline/generated-types'

import { Pages } from '~/collections/pages/schema'

import { advertisedLocalesFor } from '@/lib/alternates'
import { cacheKeys, tags, withCache } from '@/lib/cache/with-cache'
import { PUBLISHED_TTL_MS, type PublishedEntry, stringOrUndefined } from '@/lib/sitemap'

type PagesPublishedFields = Pick<PagesFields, 'title' | 'summary' | 'area' | 'publishedOn'>

export async function getPublishedPages(): Promise<PublishedEntry[]> {
  return withCache<PublishedEntry[]>({
    cacheKey: cacheKeys.sitemap('pages'),
    tags: [tags.collection('pages'), tags.sitemap('pages')],
    ttl: PUBLISHED_TTL_MS,
    fn: async () => {
      const client = getPublicBylineClient()
      const result = await client.collection('pages').find<PagesPublishedFields>({
        select: ['title', 'summary', 'area', 'publishedOn'],
        status: 'published',
        pageSize: 10_000,
      })
      const entries: PublishedEntry[] = []
      for (const doc of result.docs) {
        // Compose the URL through the collection's own `buildDocumentPath`
        // rather than a local prefix table — the same hook the richtext embed
        // walker and the admin preview button read, so an internal link, the
        // Preview button and the sitemap can't disagree about a page's URL.
        // A `null` return is the hook's "should not be linked to" signal
        // (e.g. no slug yet), so the document is omitted rather than emitted
        // at a broken URL.
        const path = Pages.buildDocumentPath?.(
          { id: doc.id, path: doc.path, status: doc.status, fields: doc.fields },
          { collectionPath: Pages.path }
        )
        if (path == null) continue
        entries.push({
          segments: path.split('/').filter(Boolean),
          title: stringOrUndefined(doc.fields.title),
          description: stringOrUndefined(doc.fields.summary),
          lastmod: doc.fields.publishedOn ?? doc.updatedAt,
          advertisedLocales: advertisedLocalesFor(doc),
        })
      }
      return entries
    },
  })
}
