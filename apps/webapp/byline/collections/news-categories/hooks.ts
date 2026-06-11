/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-only lifecycle hooks for the `news-categories` collection — L1
 * cache invalidation. Loaded via `hooks: () => import('./hooks.js')` so
 * the cache runtime stays out of the client bundle; see `../docs/hooks.ts`
 * for the full explanation of that affordance.
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
  afterCreate: async ({ collectionPath }) => {
    await invalidateCollection(collectionPath)
    await invalidateCollection('news')
  },
  afterUpdate: async ({ collectionPath }) => {
    await invalidateCollection(collectionPath)
    await invalidateCollection('news')
  },
  afterDelete: async ({ collectionPath }) => {
    await invalidateCollection(collectionPath)
    await invalidateCollection('news')
  },
})
