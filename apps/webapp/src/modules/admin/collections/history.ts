/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { getCollectionSchemasForPath, getServerConfig } from '@byline/core'

import { ensureCollection } from '@/lib/api-utils'
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
    if (!config) throw new Error('Collection not found')

    const db = getServerConfig().db
    const result = await db.queries.documents.getDocumentHistory({
      collection_id: config.collection.id,
      document_id: id,
      locale: params.locale ?? 'en',
      page: params.page,
      page_size: params.page_size,
      order: params.order,
      desc: params.desc,
    })

    const serialised = serialise(result)

    // When locale is 'all' the storage layer returns localized fields as
    // locale-keyed objects which don't conform to the typed Zod schema — skip
    // validation in that case, same as getCollectionDocument.
    if (params.locale === 'all') {
      return serialised
    }

    const { history } = getCollectionSchemasForPath(path)
    return history.parse(serialised)
  })
