/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * API Route: GET /api/:collection/:id/history
 *
 * Get the version history for a specific document by ID in a collection.
 * Note: this expects a logical document_id, and not a document version ID.
 */

import { createFileRoute } from '@tanstack/react-router'

import { getServerConfig } from '@byline/core'

import { ensureCollection, historySchema } from '@/lib/api-utils'

export const Route = createFileRoute('/admin/api/$collection/$id/history')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { collection: path, id } = params

        const config = await ensureCollection(path)
        if (config == null) {
          return Response.json(
            { error: 'Collection not found in registry or could not be created.' },
            { status: 404 }
          )
        }

        const search = Object.fromEntries(new URL(request.url).searchParams)
        const parsed = historySchema.safeParse({ ...search, document_id: id })

        if (!parsed.success) {
          return Response.json(
            { error: 'Invalid query parameters', issues: parsed.error.issues },
            { status: 400 }
          )
        }

        const db = getServerConfig().db

        const result = await db.queries.documents.getDocumentHistory({
          collection_id: config.collection.id,
          locale: 'en',
          ...parsed.data,
        })

        return Response.json(result)
      },
    },
  },
})
