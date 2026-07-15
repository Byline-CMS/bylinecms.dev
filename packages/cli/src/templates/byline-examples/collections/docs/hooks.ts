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
 * Search indexing is the canonical reason this matters: it imports the
 * server-only app client boundary from `byline/client.server.ts`. Importing
 * that from the schema would drag server code into the browser bundle (fatal
 * in dev). The schema avoids it by referencing these hooks through a
 * **dynamic import** instead of an inline object:
 *
 *     // schema.ts
 *     hooks: () => import('./hooks.js')
 *
 * Because the schema reaches this module only through `import()`, this file —
 * and its entire transitive import graph — is **structurally absent** from
 * the client bundle. `@byline/core` resolves the loader once on the server
 * (memoized) and calls these hooks exactly as it would inline ones. The
 * upshot: **inside this file we may statically import server-only modules
 * directly.** See docs/04-collections → "Hooks must not statically import
 * server-only code".
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  Search indexing
 * ──────────────────────────────────────────────────────────────────────────
 * Indexing rides the same lifecycle hooks. The orchestration lives in
 * `@byline/client`: `indexDocument` re-reads the *published* view per locale
 * and upserts / removes (so publish, unpublish, draft-over-published, and
 * plain edits all converge on the same idempotent path); `removeFromIndex`
 * drops every locale on delete.
 *
 * Resolve the client with `getSystemBylineClient()` (super-admin context, no
 * session cookies) — NOT the request-scoped `getAdminBylineClient()`.
 * Indexing is background maintenance that runs from out-of-band write paths
 * too (the import-docs script, seeds, migrations), where there is no HTTP
 * request to read a session cookie from. See
 * docs/05-reading-and-delivery/07-search.md.
 */

import { defineHooks } from '@byline/core'
import { getSystemBylineClient } from '../../client.server.js'

export default defineHooks({
  beforeCreate: async ({ data, collectionPath }) => {
    console.log(`beforeCreate: creating a document in '${collectionPath}'`, data)
  },
  afterCreate: async ({ collectionPath, documentId, documentVersionId }) => {
    console.log(
      `afterCreate: document ${documentId} (version ${documentVersionId}) created in '${collectionPath}'`
    )
    await getSystemBylineClient().collection('docs').indexDocument(documentId)
  },
  beforeUpdate: async ({ data, collectionPath }) => {
    console.log(`beforeUpdate: updating a document in '${collectionPath}'`, data)
  },
  afterUpdate: async ({ collectionPath, documentId, documentVersionId }) => {
    console.log(
      `afterUpdate: document ${documentId} (version ${documentVersionId}) in '${collectionPath}' updated`
    )
    await getSystemBylineClient().collection('docs').indexDocument(documentId)
  },
  beforeStatusChange: async ({ documentId, collectionPath, previousStatus, nextStatus }) => {
    console.log(
      `beforeStatusChange: ${documentId} in '${collectionPath}' ${previousStatus} → ${nextStatus}`
    )
  },
  // Publish / unpublish flow through the status lifecycle (not afterUpdate),
  // so re-index here too — this is when content becomes visible / invisible
  // to anonymous traffic.
  afterStatusChange: async ({ documentId, collectionPath, previousStatus, nextStatus }) => {
    console.log(
      `afterStatusChange: ${documentId} in '${collectionPath}' ${previousStatus} → ${nextStatus}`
    )
    await getSystemBylineClient().collection('docs').indexDocument(documentId)
  },
  beforeUnpublish: async ({ documentId, collectionPath }) => {
    console.log(`beforeUnpublish: unpublishing ${documentId} in '${collectionPath}'`)
  },
  afterUnpublish: async ({ documentId, collectionPath }) => {
    console.log(`afterUnpublish: ${documentId} in '${collectionPath}' unpublished`)
    await getSystemBylineClient().collection('docs').indexDocument(documentId)
  },
  beforeDelete: async ({ documentId, collectionPath }) => {
    console.log(`beforeDelete: deleting ${documentId} in '${collectionPath}'`)
  },
  afterDelete: async ({ documentId, collectionPath }) => {
    console.log(`afterDelete: ${documentId} in '${collectionPath}' deleted`)
    await getSystemBylineClient().collection('docs').removeFromIndex(documentId)
  },
  // Fires on any structural tree change (place / reorder / re-parent /
  // promote-on-delete) for a `tree: true` collection. The payload carries the
  // affected set; a docs site typically invalidates its nav / breadcrumb /
  // prev-next caches here. A tree move doesn't change a document's indexable
  // text, so there's nothing to re-index.
  afterTreeChange: async ({ collectionPath }) => {
    console.log(`afterTreeChange: tree structure changed in '${collectionPath}'`)
  },
})
