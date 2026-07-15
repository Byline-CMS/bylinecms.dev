/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-only lifecycle hooks for the `news` collection — L1 cache
 * invalidation. Loaded from `../server-hooks.ts`, which is reachable only from
 * the server bootstrap, so the cache runtime (whose cluster manager imports
 * `node:dns`) stays out of the client bundle. See `../docs/hooks.ts` for the
 * full boundary explanation.
 *
 * `news` is list-bearing: updates clear the document's detail (plus the old
 * path on a rename) and the list reads; structural events (create / publish /
 * unpublish / delete) additionally sweep the sitemap. Cross-collection
 * embeds run the other way — see `../news-categories/hooks.ts`, which
 * big-hammers every news read when a category changes.
 */

import { defineHooks } from '@byline/core'

import { invalidateCollection, invalidateDocument } from '@/lib/cache/with-cache'
import { getSystemBylineClient } from '../../clients.server.js'

const list = { list: true }
const structural = { list: true, sitemap: true }

export default defineHooks({
  afterCreate: async ({ path, documentId }) => {
    // Cache invalidation and search reconciliation are independent post-commit
    // effects. Promise.all starts both, but reports only the first rejection.
    // For complete failure reporting, see "Advanced pattern: aggregate every
    // side-effect failure" in docs/04-collections/index.md.
    await Promise.all([
      invalidateDocument('news', path, structural),
      getSystemBylineClient().collection('news').indexDocument(documentId),
    ])
  },
  afterUpdate: async ({ path, documentId, originalData }) => {
    // Cache invalidation and search reconciliation are independent post-commit
    // effects. Promise.all starts both, but reports only the first rejection.
    // For complete failure reporting, see "Advanced pattern: aggregate every
    // side-effect failure" in docs/04-collections/index.md.
    await Promise.all([
      invalidateDocument('news', path, {
        prevPath: (originalData as { path?: string } | undefined)?.path,
        ...list,
      }),
      getSystemBylineClient().collection('news').indexDocument(documentId),
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
        ? invalidateCollection('news')
        : currentPath != null
          ? invalidateDocument('news', currentPath, {
              prevPath: previousPath,
              ...structural,
            })
          : undefined,
      ...(requested.path
        ? [getSystemBylineClient().collection('news').indexDocument(documentId)]
        : []),
    ])
  },
  afterStatusChange: async ({ path, documentId }) => {
    // Cache invalidation and search reconciliation are independent post-commit
    // effects. Promise.all starts both, but reports only the first rejection.
    // For complete failure reporting, see "Advanced pattern: aggregate every
    // side-effect failure" in docs/04-collections/index.md.
    await Promise.all([
      invalidateDocument('news', path, structural),
      getSystemBylineClient().collection('news').indexDocument(documentId),
    ])
  },
  afterUnpublish: async ({ path, documentId }) => {
    // Cache invalidation and search reconciliation are independent post-commit
    // effects. Promise.all starts both, but reports only the first rejection.
    // For complete failure reporting, see "Advanced pattern: aggregate every
    // side-effect failure" in docs/04-collections/index.md.
    await Promise.all([
      invalidateDocument('news', path, structural),
      getSystemBylineClient().collection('news').indexDocument(documentId),
    ])
  },
  afterDelete: async ({ path, documentId }) => {
    // Cache invalidation and search reconciliation are independent post-commit
    // effects. Promise.all starts both, but reports only the first rejection.
    // For complete failure reporting, see "Advanced pattern: aggregate every
    // side-effect failure" in docs/04-collections/index.md.
    await Promise.all([
      getSystemBylineClient().collection('news').removeFromIndex(documentId),
      invalidateDocument('news', path, structural),
    ])
  },
})
