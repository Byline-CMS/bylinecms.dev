/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-only lifecycle hooks for the `pages` collection — L1 cache
 * invalidation. Loaded via `hooks: () => import('./hooks.js')` so the
 * cache runtime stays out of the client bundle; see `../docs/hooks.ts`
 * for the full explanation of that affordance.
 *
 * `pages` has no public list view, so updates clear only the document's
 * detail (plus the old path on a rename); structural events (create /
 * publish / unpublish / delete) additionally sweep the sitemap.
 */

import { defineHooks } from '@byline/core'

import { invalidateDocument } from '@/lib/cache/with-cache'

export default defineHooks({
  afterCreate: ({ path }) => invalidateDocument('pages', path, { sitemap: true }),
  afterUpdate: ({ path, originalData }) =>
    invalidateDocument('pages', path, {
      prevPath: (originalData as { path?: string } | undefined)?.path,
    }),
  afterStatusChange: ({ path }) => invalidateDocument('pages', path, { sitemap: true }),
  afterUnpublish: ({ path }) => invalidateDocument('pages', path, { sitemap: true }),
  afterDelete: ({ path }) => invalidateDocument('pages', path, { sitemap: true }),
})
