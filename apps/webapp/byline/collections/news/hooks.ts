/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-only lifecycle hooks for the `news` collection — L1 cache
 * invalidation. Loaded through a `createServerOnlyFn`-wrapped dynamic import so
 * the cache runtime (whose cluster manager imports `node:dns`) stays out of
 * the client bundle; see `../docs/hooks.ts` for the full explanation of
 * that affordance.
 *
 * `news` is list-bearing: updates clear the document's detail (plus the old
 * path on a rename) and the list reads; structural events (create / publish /
 * unpublish / delete) additionally sweep the sitemap. Cross-collection
 * embeds run the other way — see `../news-categories/hooks.ts`, which
 * big-hammers every news read when a category changes.
 */

import { createPublicLifecycleHooks } from '../create-public-lifecycle-hooks.js'

export default createPublicLifecycleHooks({
  collectionPath: 'news',
  listBearing: true,
})
