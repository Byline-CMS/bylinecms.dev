/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
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

export const Route = createFileRoute('/api/$collection/$id/history')({
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
