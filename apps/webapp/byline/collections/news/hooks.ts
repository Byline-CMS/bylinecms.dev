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

import { invalidateCollection, invalidateDocument } from '@/lib/cache/with-cache'
import { getSystemBylineClient } from '../../client.server.js'
import { runSideEffects } from '../run-side-effects.js'

export default defineHooks({
  afterCreate: async ({ path, documentId }) => {
    await runSideEffects(
      'news afterCreate',
      () => invalidateDocument('news', path, { list: true, sitemap: true }),
      () => getSystemBylineClient().collection('news').indexDocument(documentId)
    )
  },
  afterUpdate: async ({ path, originalData, documentId }) => {
    await runSideEffects(
      'news afterUpdate',
      () =>
        invalidateDocument('news', path, {
          prevPath: (originalData as { path?: string } | undefined)?.path,
          list: true,
        }),
      () => getSystemBylineClient().collection('news').indexDocument(documentId)
    )
  },
  afterSystemFieldsChange: async ({
    documentId,
    previousPath,
    currentPath,
    requested,
    reconciliation,
  }) => {
    const invalidate = () =>
      reconciliation && requested.path
        ? invalidateCollection('news')
        : currentPath != null
          ? invalidateDocument('news', currentPath, {
              prevPath: previousPath,
              list: true,
              sitemap: true,
            })
          : undefined
    await runSideEffects(
      'news afterSystemFieldsChange',
      invalidate,
      ...(requested.path
        ? [() => getSystemBylineClient().collection('news').indexDocument(documentId)]
        : [])
    )
  },
  afterStatusChange: async ({ path, documentId }) => {
    await runSideEffects(
      'news afterStatusChange',
      () => invalidateDocument('news', path, { list: true, sitemap: true }),
      () => getSystemBylineClient().collection('news').indexDocument(documentId)
    )
  },
  afterUnpublish: async ({ path, documentId }) => {
    await runSideEffects(
      'news afterUnpublish',
      () => invalidateDocument('news', path, { list: true, sitemap: true }),
      () => getSystemBylineClient().collection('news').indexDocument(documentId)
    )
  },
  afterDelete: async ({ path, documentId }) => {
    await runSideEffects(
      'news afterDelete',
      () => getSystemBylineClient().collection('news').removeFromIndex(documentId),
      () => invalidateDocument('news', path, { list: true, sitemap: true })
    )
  },
})
