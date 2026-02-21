/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * API Route: POST /api/:collection/:id/unpublish
 *
 * Unpublish a document by archiving its published version.
 *
 * This is a cross-version action — it targets a *previous* version with
 * status 'published' and sets it to 'archived'. The current draft version
 * is left untouched.
 *
 * This is NOT a workflow transition on the current version — it's an
 * administrative action that takes the published content offline.
 */

import { createFileRoute } from '@tanstack/react-router'

import { getServerConfig } from '@byline/core'
import type { DocumentLifecycleContext } from '@byline/core/services'
import { unpublishDocument } from '@byline/core/services'

import { ensureCollection } from '@/lib/api-utils'

export const Route = createFileRoute('/admin/api/$collection/$id/unpublish')({
  server: {
    handlers: {
      POST: async ({ params }) => {
        const { collection: path, id } = params

        const config = await ensureCollection(path)
        if (config == null) {
          return Response.json(
            { error: 'Collection not found in registry or could not be created.' },
            { status: 404 }
          )
        }

        const db = getServerConfig().db
        const ctx: DocumentLifecycleContext = {
          db,
          definition: config.definition,
          collectionId: config.collection.id,
          collectionPath: path,
        }

        const result = await unpublishDocument(ctx, { documentId: id })

        if (result.archivedCount === 0) {
          return Response.json(
            { error: 'No published version found for this document.' },
            { status: 404 }
          )
        }

        return Response.json({
          status: 'ok',
          archivedCount: result.archivedCount,
        })
      },
    },
  },
})
