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

export interface CollectionSearchParams {
  page?: number
  page_size?: number
  order?: string
  desc?: boolean
  query?: string
  locale?: string
  status?: string
}

// ---------------------------------------------------------------------------
// List documents
// ---------------------------------------------------------------------------

export const getCollectionDocuments = createServerFn({ method: 'GET' })
  .inputValidator((input: { collection: string; params: CollectionSearchParams }) => input)
  .handler(async ({ data }) => {
    const { collection: path, params } = data
    const config = await ensureCollection(path)
    if (!config) throw new Error('Collection not found')

    const db = getServerConfig().db
    const result = await db.queries.documents.getDocumentsByPage({
      collection_id: config.collection.id,
      locale: params.locale ?? 'en',
      page: params.page,
      page_size: params.page_size,
      order: params.order,
      desc: params.desc,
      query: params.query,
      status: params.status,
    })

    const serialised = serialise(result)

    // Validate with schema for runtime type safety and field normalisation.
    const { list } = getCollectionSchemasForPath(path)
    return list.parse(serialised)
  })
