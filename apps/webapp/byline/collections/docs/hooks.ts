/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-only lifecycle hooks for the `docs` collection.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  Why this file exists (the affordance)
 * ──────────────────────────────────────────────────────────────────────────
 * A collection *schema* (`./schema.ts`) is **isomorphic** — Byline bundles it
 * into the browser admin as well as the server, because the admin reads field
 * config from it. Anything the schema *statically imports* therefore ships to
 * the client. Hook *bodies*, however, only ever run server-side.
 *
 * The L1 data cache is the canonical example: `@/lib/cache/with-cache` pulls
 * `./index` → `./cluster-manager`, which imports `node:dns`. Importing that
 * graph from the schema would drag a Node built-in (which throws in the
 * browser) into the client bundle — silent in `build` (tree-shaken away) but
 * fatal in `dev` (`Module "node:dns" has been externalized for browser
 * compatibility`).
 *
 * The schema avoids that by putting the dynamic import inside TanStack Start's
 * **server-only function** instead of using an inline object or plain import:
 *
 *     // schema.ts
 *     const loadHooks = createServerOnlyFn(() => import('./hooks.js'))
 *     // ...
 *     hooks: loadHooks
 *
 * The transform removes the callback body and its transitive import graph from
 * the client bundle. `@byline/core` resolves the real loader once on the server
 * (memoized) and calls these hooks exactly as it would inline ones. The
 * upshot: **inside this file we may statically import server-only modules
 * directly** — both the cache runtime and `node:crypto` below are the
 * affordance in action; placing either import at the top of `schema.ts`
 * would crash the dev server. See docs/04-collections/index.md → "Hooks must not
 * statically import server-only code" and docs/DATA-CACHE-DESIGN.md.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  Invalidation policy for `docs`
 * ──────────────────────────────────────────────────────────────────────────
 * `docs` is a list-bearing collection, so edits affect its list reads too.
 * Per-document invalidation (every hook carries `path`): a single edit clears
 * only this document's detail — other docs' cached detail stay warm.
 *   - update    → detail (+ old path on rename) + list (title/summary show in lists)
 *   - structural (create / publish / unpublish / delete) → detail + list + sitemap
 * `afterStatusChange` / `afterUnpublish` are included because publish /
 * unpublish flow through the status lifecycle, not `afterUpdate`, and they are
 * when content becomes visible / invisible to anonymous traffic.
 *
 * Hooks run outside the storage transaction, so these awaits are safe.
 */

import { createHash } from 'node:crypto'

import { createPublicLifecycleHooks } from '../create-public-lifecycle-hooks.js'

// Search indexing rides the same lifecycle hooks as cache invalidation. The
// orchestration lives in `@byline/client`: `indexDocument` re-reads the
// published view per locale and upserts / removes (so publish, unpublish,
// draft-over-published, and plain edits all converge on the same idempotent
// path); `removeFromIndex` drops every locale on delete. See
// docs/05-reading-and-delivery/07-search.md.
export default createPublicLifecycleHooks({
  collectionPath: 'docs',
  listBearing: true,
  onCreate: ({ data, collectionPath, documentId }) => {
    // Example use of a server-only import: derive a content fingerprint with
    // Node's crypto module — only safe here because this module never
    // reaches the client bundle (see the affordance note above).
    const fingerprint = createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 12)
    console.log(
      `afterCreate: document ${documentId} created in '${collectionPath}' (content fingerprint ${fingerprint})`
    )
  },
  // A structural tree change (place / reorder / re-parent / promote-on-delete)
  // ripples across the affected set — every moved node, its descendants, and
  // both sibling lists have new breadcrumbs / hierarchical canonical URLs. Trees
  // are small and restructures are infrequent, so the coarse collection-wide
  // sweep (detail + list + sitemap) is the pragmatic correct choice over
  // resolving the affected ids to paths. See docs/04-collections/03-document-trees.md →
  // "Invalidation contract".
  invalidateTree: true,
})
