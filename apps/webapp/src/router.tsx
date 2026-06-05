/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createRouter } from '@tanstack/react-router'

import { localeInputRewrite, localeOutputRewrite } from '@/i18n/locale-rewrite'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const router = createRouter({
    routeTree,
    // Isomorphic locale URL rewrite (runs on both server request-parse and
    // client navigation). `input` guarantees the matcher always sees a
    // locale-prefixed frontend URL (the required `$lng` segment); `output`
    // strips the default locale so the address bar / generated hrefs stay
    // clean for `en`. Non-default and content-only locales are preserved.
    // See `src/i18n/locale-rewrite.ts` for the two invariants.
    rewrite: {
      input: ({ url }) => localeInputRewrite(url),
      output: ({ url }) => localeOutputRewrite(url),
    },
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadDelay: 50, // optional, ms before intent fires
    // Loader data is fresh for 5s, so rapid client-side navigation reuses
    // the in-memory copy; after that a navigation revalidates rather than
    // serving a stale public page.
    defaultStaleTime: 5_000,
    // Match preload freshness to staleTime. Without this, `defaultPreload:
    // 'intent'` treats hover-preloaded data as fresh for 30s, so a click
    // within that window serves a cached page body with no revalidation.
    // A revalidation is cheap — it hits the server fn, which Cloudflare
    // serves from its 60s edge cache for anonymous visitors.
    defaultPreloadStaleTime: 5_000,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
