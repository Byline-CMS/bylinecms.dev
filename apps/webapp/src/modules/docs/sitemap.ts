/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Per-collection sitemap getter for `docs` — a thin shape adapter over
 * the shared published-URL enumeration in `@/lib/published-index`, which
 * `llms.txt` consumes too (one scan, one cache entry, no drift).
 */

import { getDocsIndex } from '@/lib/published-index'
import { type SitemapEntry, toSitemapDate } from '@/lib/sitemap'

export async function getDocsSitemap(): Promise<SitemapEntry[]> {
  const entries = await getDocsIndex()
  return entries.map((entry) => ({
    segments: entry.segments,
    lastmod: toSitemapDate(entry.lastmod),
    advertisedLocales: entry.advertisedLocales,
  }))
}
