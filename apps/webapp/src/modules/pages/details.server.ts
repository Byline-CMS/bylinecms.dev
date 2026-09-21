/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-only implementation of the Page detail read. Loaded via a dynamic
 * `import()` from `./details` so the Byline viewer SDK never enters the client
 * bundle — see the boundary note in `./details`.
 *
 * Reads through the shared *viewer* `BylineClient` so unpublished versions stay
 * invisible for ordinary visitors but become visible to admins who have toggled
 * preview mode (cookie + valid admin session). Populates `featureImage` and
 * photo-block `photo` relations so the page renders without follow-up requests.
 *
 * The published read is wrapped in `withCache` (L1), tagged so the collection's
 * lifecycle hooks invalidate it on change; an active preview bypasses the cache
 * entirely and reads live.
 */

import { getViewerBylineClient, isPreviewActive } from '@byline/client/server'

import { buildPagePath } from '~/collections/pages/path'
import { defaultContentLocale } from '~/public'

import { cacheKeys, tags, withCache } from '@/lib/cache/with-cache'
import type { PageDetailsFields, PageDetailsInput, PageDetailsResult } from './details'

export async function getPagePath(path: string): Promise<string | null> {
  const client = getViewerBylineClient()
  const preview = await isPreviewActive()
  // Area and slug are not localized. Keep this small navigation projection
  // separate from detail bodies, with the same edit invalidation and preview rules.
  return withCache({
    cacheKey: `${cacheKeys.details('pages', path, defaultContentLocale)}::path`,
    tags: [tags.collection('pages'), tags.details('pages', path)],
    preview,
    fn: async () => {
      const doc = await client
        .collection('pages')
        .findByPath<Pick<PageDetailsFields, 'area'>>(path, {
          select: ['area'],
          locale: defaultContentLocale,
          status: preview ? 'any' : 'published',
        })
      return doc == null ? null : buildPagePath(doc)
    },
  })
}

export async function getPageDetails({ path, lng }: PageDetailsInput): Promise<PageDetailsResult> {
  const client = getViewerBylineClient()
  const preview = await isPreviewActive()

  return withCache<PageDetailsResult>({
    cacheKey: cacheKeys.details('pages', path, lng),
    tags: [tags.collection('pages'), tags.details('pages', path)],
    preview,
    fn: () =>
      client.collection('pages').findByPath<PageDetailsFields>(path, {
        // A block's relation is only resolved if it is named here: an
        // unnamed one arrives as a bare envelope and the block renders as
        // nothing. Keep in step with the block set on this collection's
        // `content` field.
        populate: { featureImage: '*', photo: '*', video: '*', videoMobile: '*' },
        locale: lng,
        status: preview ? 'any' : 'published',
      }),
  })
}
