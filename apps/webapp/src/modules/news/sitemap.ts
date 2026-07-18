/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Per-collection sitemap getter for `news` — a thin shape adapter over this
 * module's published-URL enumeration (`./published`), which `llms.txt`
 * consumes too (one scan, one cache entry, no drift).
 */

import { type SitemapEntry, toSitemapDate } from '@/lib/sitemap'
import { getPublishedNews } from '@/modules/news/published'

export async function getNewsSitemap(): Promise<SitemapEntry[]> {
  const entries = await getPublishedNews()
  return entries.map((entry) => ({
    segments: entry.segments,
    lastmod: toSitemapDate(entry.lastmod),
    advertisedLocales: entry.advertisedLocales,
  }))
}
