/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute } from '@tanstack/react-router'

import { buildLocalizedPath, getMeta } from '@/lib/meta'
import { HomeView } from '@/modules/home/home-view'
import { getNewsListFn } from '@/modules/news/list'

export const Route = createFileRoute('/$lng/_frontend/')({
  // The home page's "Recent news" panel reads the three most recently
  // published news items through the same server fn the `/news` index uses —
  // so it inherits that path's public-cache middleware, cache tags, preview
  // awareness, and published-only default rather than growing its own read.
  loader: async ({ context }) => {
    const lng = context.locale
    const recentNews = await getNewsListFn({ data: { lng, pageSize: 3 } })
    return { recentNews }
  },
  // Owns the canonical / og:url for the home page (the root layout
  // intentionally doesn't emit one). `params.lng` is the optional `$lng`
  // segment — `buildLocalizedPath` resolves it to `/` for the default locale
  // and `/<lng>` otherwise.
  head: ({ params }) => getMeta({ path: buildLocalizedPath(params.lng) }),
  component: RouteComponent,
})

function RouteComponent() {
  const { recentNews } = Route.useLoaderData()
  return <HomeView recentNews={recentNews} />
}
