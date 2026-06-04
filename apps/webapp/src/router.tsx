/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createRouter } from '@tanstack/react-router'

import { routeTree } from './routeTree.gen'

export function getRouter() {
  const router = createRouter({
    routeTree,
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
