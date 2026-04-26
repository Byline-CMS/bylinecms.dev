/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import {
  ERR_NOT_FOUND,
  getCollectionSchemasForPath,
  getLogger,
  getServerConfig,
  type QueryPredicate,
} from '@byline/core'

import { ensureCollection } from '@/lib/api-utils'
import { getAdminBylineClient } from '@/lib/byline-client'
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
  fields?: string[]
}

// ---------------------------------------------------------------------------
// List documents
// ---------------------------------------------------------------------------

export const getCollectionDocuments = createServerFn({ method: 'GET' })
  .inputValidator((input: { collection: string; params: CollectionSearchParams }) => input)
  .handler(async ({ data }) => {
    const { collection: path, params } = data
    const config = await ensureCollection(path)
    if (!config) {
      throw ERR_NOT_FOUND({
        message: 'Collection not found',
        details: { collectionPath: path },
      }).log(getLogger())
    }

    const client = getAdminBylineClient()
    const handle = client.collection(path)
    const pageSize = params.page_size ?? 20

    // Routes through CollectionHandle.find so the read pipeline (beforeRead
    // → findDocuments → afterRead) is identical to any non-admin client.
    // `status: 'any'` keeps admin behaviour: in-progress drafts are visible
    // even when no published version exists. The `where.status` filter
    // (when supplied) further narrows to a specific exact status, and
    // `where.query` triggers the configured search-fields text search.
    const where: QueryPredicate = {}
    if (params.status) where.status = params.status
    if (params.query) where.query = params.query

    const result = await handle.find({
      where: Object.keys(where).length > 0 ? where : undefined,
      sort: params.order ? { [params.order]: params.desc === false ? 'asc' : 'desc' } : undefined,
      locale: params.locale ?? 'en',
      page: params.page,
      pageSize,
      select: params.fields,
      status: 'any',
    })

    // Decorate each doc with `hasPublishedVersion` so the list UI can show a
    // "live" indicator on documents that still have a published version
    // even when the current row is a newer draft. This is admin-bespoke
    // metadata, so it sits alongside the public ClientDocument shape rather
    // than inside it.
    const documentIds = result.docs.map((d) => d.id)
    const publishedSet =
      documentIds.length > 0
        ? await getServerConfig().db.queries.documents.getPublishedDocumentIds({
            collection_id: config.collection.id,
            document_ids: documentIds,
          })
        : new Set<string>()

    const docs = result.docs.map((d) => ({
      ...d,
      hasPublishedVersion: publishedSet.has(d.id),
    }))

    const response = {
      docs,
      meta: {
        ...result.meta,
        order: params.order,
        desc: params.desc,
      },
      included: {
        collection: {
          id: config.collection.id,
          path: config.collection.path,
          labels: {
            singular: config.definition.labels.singular || config.collection.path,
            plural: config.definition.labels.plural || config.collection.path,
          },
        },
      },
    }

    const serialised = serialise(response)

    // Validate with schema for runtime type safety and field normalisation.
    const { list } = getCollectionSchemasForPath(path)
    return list.parse(serialised)
  })
