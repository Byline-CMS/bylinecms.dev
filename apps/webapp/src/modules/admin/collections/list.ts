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
    if (!config) throw new Error('Collection not found')

    const db = getServerConfig().db
    const pageSize = params.page_size ?? 20

    const result = await db.queries.documents.findDocuments({
      collection_id: config.collection.id,
      locale: params.locale ?? 'en',
      page: params.page,
      pageSize,
      orderBy: params.order,
      orderDirection: params.desc === true ? 'desc' : params.desc === false ? 'asc' : undefined,
      query: params.query,
      status: params.status,
      fields: params.fields,
    })

    // Determine which documents in this page have a published version
    // anywhere in their version history. Powers the "live" indicator in the list UI.
    const documentIds = result.documents.map((d: any) => d.document_id)
    const publishedSet = new Set<string>()
    if (documentIds.length > 0) {
      const allCounts = await Promise.all(
        [...new Set(documentIds)].map(async (docId: string) => {
          const pv = await db.queries.documents.getPublishedVersion({
            collection_id: config.collection.id,
            document_id: docId,
            status: 'published',
          })
          return { docId, hasPublished: pv != null }
        })
      )
      for (const { docId, hasPublished } of allCounts) {
        if (hasPublished) publishedSet.add(docId)
      }
    }

    for (const doc of result.documents) {
      ;(doc as any).has_published_version = publishedSet.has((doc as any).document_id)
    }

    // Assemble the response shape the admin UI expects.
    const totalPages = Math.ceil(result.total / pageSize)
    const response = {
      documents: result.documents,
      meta: {
        total: result.total,
        page: params.page ?? 1,
        page_size: pageSize,
        total_pages: totalPages,
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
