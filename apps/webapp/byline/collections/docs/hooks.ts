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
 * If hooks were declared inline in the schema, any server-only module they
 * import (a Node built-in, a DB client, a cache/queue, secrets) would be
 * dragged into the client bundle — silently in `build` (tree-shaken away),
 * but fatally in `dev` (Vite evaluates it and a `node:*` import throws
 * `Module "node:…" has been externalized for browser compatibility`).
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
 * (memoized) and calls these hooks exactly as it would inline ones.
 *
 * The practical upshot, and the whole point of advertising hooks as
 * server-only: **inside this file you are free to statically import whatever
 * you like.** The `node:crypto` import below is a deliberate demonstration —
 * placing that same import at the top of `schema.ts` would crash the dev
 * server; here it is completely safe.
 */

import { createHash } from 'node:crypto'

import { defineHooks } from '@byline/core'

/**
 * `defineHooks(...)` is the named factory counterpart to `defineCollection` /
 * `defineBlock`. It returns the object unchanged and types it as
 * `CollectionHooks`; `export default { … } satisfies CollectionHooks` is
 * equivalent. Each hook may be a single function or an array of functions
 * (arrays run sequentially in declaration order).
 */
export default defineHooks({
  beforeCreate: async ({ data, collectionPath }) => {
    // Example: beforeCreate hook. Runs before the document is persisted and
    // may mutate `data`.
    console.log(
      `beforeCreate: Creating a new document in collection ${collectionPath} with data:`,
      data
    )
  },
  afterCreate: async ({ data, collectionPath, documentId, documentVersionId }) => {
    // Example use of a server-only import: derive a content fingerprint with
    // Node's crypto module. This is the affordance in action — `node:crypto`
    // is imported statically at the top of this file, which is only safe
    // because the module never reaches the client bundle.
    const fingerprint = createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 12)
    console.log(
      `afterCreate: Document created with ID ${documentId} and version ID ${documentVersionId} in collection ${collectionPath} (content fingerprint ${fingerprint})`
    )
  },
  beforeUpdate: async ({ data, originalData, collectionPath }) => {
    // Example: inspect/guard the next version before it is persisted. `data`
    // is the incoming version (mutable); `originalData` is the previous one.
    console.log(
      `beforeUpdate: Updating a document in collection ${collectionPath} with data:`,
      data
    )
  },
  afterUpdate: async ({ data, originalData, collectionPath, documentId, documentVersionId }) => {
    // Example: log the update of a document. A real app might invalidate a
    // cache key or purge a CDN URL for `path` here.
    console.log(
      `afterUpdate: Document with ID ${documentId} and version ID ${documentVersionId} in collection ${collectionPath} was updated`
    )
  },
  beforeStatusChange: async ({
    documentId,
    documentVersionId,
    collectionPath,
    previousStatus,
    nextStatus,
  }) => {
    console.log(
      `beforeStatusChange: Changing status of document in collection ${collectionPath} from ${previousStatus} to ${nextStatus} with document ID ${documentId} and version ID ${documentVersionId}`
    )
  },
  afterStatusChange: async ({
    documentId,
    documentVersionId,
    collectionPath,
    previousStatus,
    nextStatus,
  }) => {
    console.log(
      `afterStatusChange: Status of document in collection ${collectionPath} changed from ${previousStatus} to ${nextStatus} with document ID ${documentId} and version ID ${documentVersionId}`
    )
  },
  beforeUnpublish: async ({ documentId, collectionPath }) => {
    console.log(
      `beforeUnpublish: Unpublishing document in collection ${collectionPath} with document ID ${documentId}.`
    )
  },
  afterUnpublish: async ({ documentId, collectionPath }) => {
    console.log(
      `afterUnpublish: Document in collection ${collectionPath} with document ID ${documentId} unpublished.`
    )
  },
  beforeDelete: async ({ documentId, collectionPath }) => {
    console.log(
      `beforeDelete: Deleting document in collection ${collectionPath} with document ID ${documentId}.`
    )
  },
  afterDelete: async ({ documentId, collectionPath }) => {
    console.log(
      `afterDelete: Document in collection ${collectionPath} with document ID ${documentId} deleted.`
    )
  },
})
