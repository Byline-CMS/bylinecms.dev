/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Admin server fn: rebuild a collection's search index. Thin boundary over
 * `CollectionHandle.reindex()` — which clears the index slice and re-indexes
 * every published document. Routes through `getAdminBylineClient()` so the
 * request's admin actor is used; `reindex()` asserts the
 * `collections.<path>.reindex` ability, so authorization is enforced here even
 * though the button is also permission-gated in the UI.
 *
 * Synchronous today (fine for small/medium collections). A large corpus wants
 * this backgrounded with progress — see docs/05-reading-and-delivery/07-search.md
 * ("reindex cost").
 */

import { createServerFn } from '@tanstack/react-start'

import type { ReindexResult } from '@byline/client'
import { ERR_NOT_FOUND, getLogger } from '@byline/core'

import { ensureCollection } from '../../integrations/api-utils.js'
import { getAdminBylineClient } from '../../integrations/byline-client.js'

export type { ReindexResult }

export const reindexCollection = createServerFn({ method: 'POST' })
  .validator((input: { collection: string }) => input)
  .handler(async ({ data }): Promise<ReindexResult> => {
    const { collection } = data
    const config = await ensureCollection(collection)
    if (!config) {
      throw ERR_NOT_FOUND({
        message: 'Collection not found',
        details: { collectionPath: collection },
      }).log(getLogger())
    }

    // `reindex()` asserts `collections.<collection>.reindex` against the
    // request's admin actor before doing any work.
    return getAdminBylineClient().collection(collection).reindex()
  })
