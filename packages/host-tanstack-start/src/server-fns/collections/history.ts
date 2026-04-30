/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { ERR_NOT_FOUND, getCollectionSchemasForPath, getLogger } from '@byline/core'

import { ensureCollection } from '../../integrations/api-utils.js'
import { getAdminBylineClient } from '../../integrations/byline-client.js'
import { serialise } from './utils'

// ---------------------------------------------------------------------------
// Shared param types
// ---------------------------------------------------------------------------

export interface HistorySearchParams {
  page?: number
  page_size?: number
  order?: string
  desc?: boolean
  locale?: string
}

// ---------------------------------------------------------------------------
// Get document version history
// ---------------------------------------------------------------------------

export const getCollectionDocumentHistory = createServerFn({ method: 'GET' })
  .inputValidator((input: { collection: string; id: string; params: HistorySearchParams }) => input)
  .handler(async ({ data }) => {
    const { collection: path, id, params } = data
    const config = await ensureCollection(path)
    if (!config) {
      throw ERR_NOT_FOUND({
        message: 'Collection not found',
        details: { collectionPath: path },
      }).log(getLogger())
    }

    // Routes through CollectionHandle.history so the access gate
    // (`beforeRead` via `findById`) is applied consistently with the rest
    // of the read pipeline. When the actor's predicate excludes the
    // document, history returns an empty result rather than leaking
    // version metadata.
    const result = await getAdminBylineClient()
      .collection(path)
      .history(id, {
        locale: params.locale ?? 'en',
        page: params.page,
        pageSize: params.page_size,
        order: params.order,
        desc: params.desc,
      })

    const serialised = serialise(result)
    const { history } = getCollectionSchemasForPath(path)

    // When locale is 'all' the storage layer returns localized fields as
    // locale-keyed objects which don't conform to the typed Zod schema — skip
    // validation in that case, same as getCollectionDocument. Cast through
    // the inferred Zod type so both branches share one return shape; the
    // runtime contents are structurally compatible.
    if (params.locale === 'all') {
      return serialised as unknown as ReturnType<typeof history.parse>
    }

    return history.parse(serialised)
  })
