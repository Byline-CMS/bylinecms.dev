/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-only lifecycle hooks for the `pages` collection — L1 cache
 * invalidation. Loaded from `../server-hooks.ts`, which is reachable only from
 * the server bootstrap, so the cache runtime stays out of the client bundle.
 * See `../docs/hooks.ts` for the full boundary explanation.
 *
 * `pages` has no public list view, so updates clear only the document's
 * detail (plus the old path on a rename); structural events (create /
 * publish / unpublish / delete) additionally sweep the sitemap.
 */

import { getSystemBylineClient } from '@byline/client/server'
import { defineHooks } from '@byline/core'

import { invalidateCollection, invalidateDocument } from '@/lib/cache/with-cache'

const structural = { sitemap: true }

export default defineHooks({
  afterCreate: async ({ path, documentId }) => {
    // Cache invalidation and search reconciliation are independent post-commit
    // effects. Promise.all starts both, but reports only the first rejection.
    // For complete failure reporting, see "Advanced pattern: aggregate every
    // side-effect failure" in docs/04-collections/index.md.
    await Promise.all([
      invalidateDocument('pages', path, structural),
      getSystemBylineClient().collection('pages').indexDocument(documentId),
    ])
  },
  afterUpdate: async ({ path, documentId, originalData }) => {
    // Cache invalidation and search reconciliation are independent post-commit
    // effects. Promise.all starts both, but reports only the first rejection.
    // For complete failure reporting, see "Advanced pattern: aggregate every
    // side-effect failure" in docs/04-collections/index.md.
    await Promise.all([
      invalidateDocument('pages', path, {
        prevPath: (originalData as { path?: string } | undefined)?.path,
      }),
      getSystemBylineClient().collection('pages').indexDocument(documentId),
    ])
  },
  afterSystemFieldsChange: async ({
    documentId,
    previousPath,
    currentPath,
    requested,
    reconciliation,
  }) => {
    // Cache invalidation and search reconciliation are independent post-commit
    // effects. Promise.all starts both, but reports only the first rejection.
    // For complete failure reporting, see "Advanced pattern: aggregate every
    // side-effect failure" in docs/04-collections/index.md.
    await Promise.all([
      reconciliation && requested.path
        ? invalidateCollection('pages')
        : currentPath != null
          ? invalidateDocument('pages', currentPath, {
              prevPath: previousPath,
              ...structural,
            })
          : undefined,
      // A path change moves the indexed URL; a locale change alters which
      // translations are publicly delivered. `requested` (not `changed`) so a
      // no-op reconciliation retry re-runs indexing after a failed attempt.
      ...(requested.path || requested.availableLocales
        ? [getSystemBylineClient().collection('pages').indexDocument(documentId)]
        : []),
    ])
  },
  afterStatusChange: async ({ path, documentId }) => {
    // Cache invalidation and search reconciliation are independent post-commit
    // effects. Promise.all starts both, but reports only the first rejection.
    // For complete failure reporting, see "Advanced pattern: aggregate every
    // side-effect failure" in docs/04-collections/index.md.
    await Promise.all([
      invalidateDocument('pages', path, structural),
      getSystemBylineClient().collection('pages').indexDocument(documentId),
    ])
  },
  afterUnpublish: async ({ path, documentId }) => {
    // Cache invalidation and search reconciliation are independent post-commit
    // effects. Promise.all starts both, but reports only the first rejection.
    // For complete failure reporting, see "Advanced pattern: aggregate every
    // side-effect failure" in docs/04-collections/index.md.
    await Promise.all([
      invalidateDocument('pages', path, structural),
      getSystemBylineClient().collection('pages').indexDocument(documentId),
    ])
  },
  afterDelete: async ({ path, documentId }) => {
    // Cache invalidation and search reconciliation are independent post-commit
    // effects. Promise.all starts both, but reports only the first rejection.
    // For complete failure reporting, see "Advanced pattern: aggregate every
    // side-effect failure" in docs/04-collections/index.md.
    await Promise.all([
      getSystemBylineClient().collection('pages').removeFromIndex(documentId),
      invalidateDocument('pages', path, structural),
    ])
  },
})
