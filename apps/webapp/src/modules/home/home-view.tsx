/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Reference home page for the demonstration site.
 *
 * Hero and intro are placeholder content — they exist so that a developer
 * who has just started the dev server can see the shape of a Byline
 * installation's home page. `RecentNews` is real: the route loader reads
 * the three most recently published items from the `news` collection.
 */

import { Hero } from '@/modules/home/hero'
import { Intro } from '@/modules/home/intro'
import { RecentNews } from '@/modules/home/recent-news'
import type { NewsListResult } from '@/modules/news/list'

export function HomeView({ recentNews }: { recentNews: NewsListResult }) {
  return (
    <>
      <Hero />
      <Intro />
      <RecentNews result={recentNews} />
    </>
  )
}
