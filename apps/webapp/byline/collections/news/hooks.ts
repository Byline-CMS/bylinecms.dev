/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-only lifecycle hooks for the `news` collection — L1 cache
 * invalidation. Loaded via `hooks: () => import('./hooks.js')` so the
 * cache runtime (whose cluster manager imports `node:dns`) stays out of
 * the client bundle; see `../docs/hooks.ts` for the full explanation of
 * that affordance.
 *
 * `news` is list-bearing: updates clear the document's detail (plus the old
 * path on a rename) and the list reads; structural events (create / publish /
 * unpublish / delete) additionally sweep the sitemap. Cross-collection
 * embeds run the other way — see `../news-categories/hooks.ts`, which
 * big-hammers every news read when a category changes.
 */

import { defineHooks } from '@byline/core'

import { invalidateDocument } from '@/lib/cache/with-cache'

export default defineHooks({
  afterCreate: ({ collectionPath, path }) =>
    invalidateDocument(collectionPath, path, { list: true, sitemap: true }),
  afterUpdate: ({ collectionPath, path, originalData }) =>
    invalidateDocument(collectionPath, path, {
      prevPath: (originalData as { path?: string } | undefined)?.path,
      list: true,
    }),
  afterStatusChange: ({ collectionPath, path }) =>
    invalidateDocument(collectionPath, path, { list: true, sitemap: true }),
  afterUnpublish: ({ collectionPath, path }) =>
    invalidateDocument(collectionPath, path, { list: true, sitemap: true }),
  afterDelete: ({ collectionPath, path }) =>
    invalidateDocument(collectionPath, path, { list: true, sitemap: true }),
})
