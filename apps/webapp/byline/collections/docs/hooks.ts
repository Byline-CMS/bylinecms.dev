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
 * The schema avoids that by referencing these hooks through a **dynamic
 * import** instead of an inline object:
 *
 *     // schema.ts
 *     hooks: () => import('./hooks.js')
 *
 * Because the schema reaches this module only through `import()`, this file —
 * and its entire transitive import graph — is **structurally absent** from
 * the client bundle. `@byline/core` resolves the loader once on the server
 * (memoized) and calls these hooks exactly as it would inline ones. The
 * upshot: **inside this file we may statically import server-only modules
 * directly** — both the cache runtime and `node:crypto` below are the
 * affordance in action; placing either import at the top of `schema.ts`
 * would crash the dev server. See docs/COLLECTIONS.md → "Hooks must not
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

import { defineHooks } from '@byline/core'

import { invalidateDocument } from '@/lib/cache/with-cache'

export default defineHooks({
  afterCreate: async ({ data, collectionPath, path, documentId }) => {
    // Example use of a server-only import: derive a content fingerprint with
    // Node's crypto module — only safe here because this module never
    // reaches the client bundle (see the affordance note above).
    const fingerprint = createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 12)
    console.log(
      `afterCreate: document ${documentId} created in '${collectionPath}' (content fingerprint ${fingerprint})`
    )
    await invalidateDocument(collectionPath, path, { list: true, sitemap: true })
  },
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
