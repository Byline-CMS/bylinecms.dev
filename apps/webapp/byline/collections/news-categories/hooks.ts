/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-only lifecycle hooks for the `news-categories` collection — L1 cache
 * invalidation. Loaded from `../server-hooks.ts`, which is reachable only from
 * the server bootstrap, so the cache runtime stays out of the client bundle.
 * See `../docs/hooks.ts` for the full boundary explanation.
 *
 * Categories are a cross-collection embed: their data is populated into
 * cached news reads (list rows and detail pages both render the category
 * name), so a category change must clear every news read — this is the
 * deliberate "big hammer" `invalidateCollection` is reserved for. No
 * sitemap sweep: categories have no URLs of their own.
 */

import { defineHooks } from '@byline/core'

import { invalidateCollection } from '@/lib/cache/with-cache'

export default defineHooks({
  afterCreate: async () => {
    await invalidateCollection('news-categories')
    await invalidateCollection('news')
  },
  afterUpdate: async () => {
    await invalidateCollection('news-categories')
    await invalidateCollection('news')
  },
  afterDelete: async () => {
    await invalidateCollection('news-categories')
    await invalidateCollection('news')
  },
})
