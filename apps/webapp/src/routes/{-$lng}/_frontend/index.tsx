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

export const Route = createFileRoute('/{-$lng}/_frontend/')({
  // Owns the canonical / og:url for the home page (the root layout
  // intentionally doesn't emit one). `params.lng` is the optional `{-$lng}`
  // segment — `buildLocalizedPath` resolves it to `/` for the default locale
  // and `/<lng>` otherwise.
  head: ({ params }) => getMeta({ path: buildLocalizedPath(params.lng) }),
  component: HomeView,
})
