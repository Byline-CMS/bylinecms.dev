/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Dynamic `llms.txt` (https://llmstxt.org) — the agent-readable site
 * index. A pure API route via TanStack Start server handlers, the exact
 * sibling of `sitemap[.]xml.ts`: locale-less top level (the rewrite's
 * asset detection leaves `.txt` alone), per-collection getters reached via
 * a handler-local dynamic `import()` to keep the server-only chain out of
 * the browser bundle, HTTP-layer caching via `Cache-Control`.
 *
 * Both surfaces consume the same published-URL enumeration
 * (`@/lib/published-index`) — the sitemap advertises HTML URLs to
 * crawlers, `llms.txt` advertises the `.md` representations to agents.
 */

import { createFileRoute } from '@tanstack/react-router'

import { getPublicConfig } from '@/config'
import { generateLlmsTxt } from '@/lib/llms'

export const Route = createFileRoute('/llms.txt')({
  server: {
    handlers: {
      GET: async () => {
        const { serverUrl, siteName, siteDescription } = getPublicConfig()
        const [{ getDocsIndex, getNewsIndex, getPagesIndex }] = await Promise.all([
          import('@/lib/published-index'),
        ])
        const [docs, news, pages] = await Promise.all([
          getDocsIndex(),
          getNewsIndex(),
          getPagesIndex(),
        ])
        const body = generateLlmsTxt(
          [
            { title: 'Documentation', entries: docs },
            { title: 'News', entries: news },
            { title: 'Pages', entries: pages },
          ],
          { name: siteName, description: siteDescription, serverUrl }
        )

        return new Response(body, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=86400',
          },
        })
      },
    },
  },
})
