/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Dynamic `sitemap.xml` — a pure API route via TanStack Start server
 * handlers (no component, no route-tree match). The `[.]` in the filename
 * escapes the literal dot, so the URL is `/sitemap.xml`. Lives at the top
 * level (a sibling of `$lng`, not under it) so the URL is locale-agnostic;
 * the rewrite leaves it alone (asset detection via the `.xml` extension).
 *
 * Caching is handled at the HTTP layer (no app-level in-memory cache for the
 * XML itself — the per-collection getters cache their scans in L1): the
 * `Cache-Control` header lets a CDN serve it for 10 minutes and revalidate
 * in the background for a day.
 */

import { createFileRoute } from '@tanstack/react-router'

import { getPublicConfig } from '@/config'
import { generateSitemap, getSitemapData, getStaticSitemap } from '@/lib/sitemap'

export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: async () => {
        const { serverUrl } = getPublicConfig()
        // The per-collection getters reach the Byline SDK and the L1 data
        // cache (whose cluster manager imports `node:dns`). This route
        // module is in the client graph — the Start compiler strips this
        // handler body on the client but keeps top-level imports — so the
        // getters are pulled in with a handler-local dynamic `import()` to keep
        // that server-only chain out of the browser bundle.
        const [{ getPagesSitemap }, { getNewsSitemap }, { getDocsSitemap }] = await Promise.all([
          import('@/modules/pages/sitemap'),
          import('@/modules/news/sitemap'),
          import('@/modules/docs/sitemap'),
        ])
        const entries = await getSitemapData([
          getStaticSitemap,
          getPagesSitemap,
          getNewsSitemap,
          getDocsSitemap,
        ])
        const xml = generateSitemap(entries, serverUrl)

        return new Response(xml, {
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=86400',
          },
        })
      },
    },
  },
})
