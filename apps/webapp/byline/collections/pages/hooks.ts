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

import { invalidateCollection, invalidateDocument } from '@/lib/cache/with-cache'
import { getSystemBylineClient } from '../../client.server.js'
import { runSideEffects } from '../run-side-effects.js'

export default defineHooks({
  afterCreate: async ({ path, documentId }) => {
    await runSideEffects(
      'pages afterCreate',
      () => invalidateDocument('pages', path, { sitemap: true }),
      () => getSystemBylineClient().collection('pages').indexDocument(documentId)
    )
  },
  afterUpdate: async ({ path, originalData, documentId }) => {
    await runSideEffects(
      'pages afterUpdate',
      () =>
        invalidateDocument('pages', path, {
          prevPath: (originalData as { path?: string } | undefined)?.path,
        }),
      () => getSystemBylineClient().collection('pages').indexDocument(documentId)
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
        ? invalidateCollection('pages')
        : currentPath != null
          ? invalidateDocument('pages', currentPath, {
              prevPath: previousPath,
              sitemap: true,
            })
          : undefined
    await runSideEffects(
      'pages afterSystemFieldsChange',
      invalidate,
      ...(requested.path
        ? [() => getSystemBylineClient().collection('pages').indexDocument(documentId)]
        : [])
    )
  },
  afterStatusChange: async ({ path, documentId }) => {
    await runSideEffects(
      'pages afterStatusChange',
      () => invalidateDocument('pages', path, { sitemap: true }),
      () => getSystemBylineClient().collection('pages').indexDocument(documentId)
    )
  },
  afterUnpublish: async ({ path, documentId }) => {
    await runSideEffects(
      'pages afterUnpublish',
      () => invalidateDocument('pages', path, { sitemap: true }),
      () => getSystemBylineClient().collection('pages').indexDocument(documentId)
    )
  },
  afterDelete: async ({ path, documentId }) => {
    await runSideEffects(
      'pages afterDelete',
      () => getSystemBylineClient().collection('pages').removeFromIndex(documentId),
      () => invalidateDocument('pages', path, { sitemap: true })
    )
  },
})
