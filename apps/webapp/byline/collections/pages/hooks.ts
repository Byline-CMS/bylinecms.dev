/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-only lifecycle hooks for the `pages` collection — L1 cache
 * invalidation. Loaded through a `createServerOnlyFn`-wrapped dynamic import so
 * the cache runtime stays out of the client bundle; see `../docs/hooks.ts`
 * for the full explanation of that affordance.
 *
 * `pages` has no public list view, so updates clear only the document's
 * detail (plus the old path on a rename); structural events (create /
 * publish / unpublish / delete) additionally sweep the sitemap.
 */

import { createPublicLifecycleHooks } from '../create-public-lifecycle-hooks.js'

export default createPublicLifecycleHooks({
  collectionPath: 'pages',
  listBearing: false,
})
