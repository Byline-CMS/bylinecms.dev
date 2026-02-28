/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * API Route: GET /admin/api/:collection/stats
 *
 * Returns a count of current documents grouped by workflow status for a
 * given collection. Only the latest (current) version of each document
 * is counted, matching the `current_documents` view.
 */

import { createFileRoute } from '@tanstack/react-router'

import { getServerConfig } from '@byline/core'

import { ensureCollection } from '@/lib/api-utils'

export const Route = createFileRoute('/(byline)/admin/api/$collection/stats')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { collection: path } = params

        const config = await ensureCollection(path)
        if (config == null) {
          return Response.json(
            { error: 'Collection not found in registry or could not be created.' },
            { status: 404 }
          )
        }

        const db = getServerConfig().db

        const counts = await db.queries.documents.getDocumentCountsByStatus({
          collection_id: config.collection.id,
        })

        return Response.json({ stats: counts })
      },
    },
  },
})
