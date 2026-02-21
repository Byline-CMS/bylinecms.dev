/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * API Route: PATCH /api/:collection/:id/status
 *
 * Change the workflow status of a document's current version.
 * This mutates the existing version row in-place — status is lifecycle
 * metadata, not content — so no new version is created.
 *
 * Request body: `{ status: string }`
 */

import { createFileRoute } from '@tanstack/react-router'

import { getServerConfig } from '@byline/core'
import type { DocumentLifecycleContext } from '@byline/core/services'
import {
  changeDocumentStatus,
  DocumentNotFoundError,
  InvalidTransitionError,
} from '@byline/core/services'

import { ensureCollection } from '@/lib/api-utils'

export const Route = createFileRoute('/admin/api/$collection/$id/status')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const { collection: path, id } = params

        const config = await ensureCollection(path)
        if (config == null) {
          return Response.json(
            { error: 'Collection not found in registry or could not be created.' },
            { status: 404 }
          )
        }

        const body = (await request.json()) as { status?: string }
        const nextStatus = body.status

        if (!nextStatus || typeof nextStatus !== 'string') {
          return Response.json(
            { error: 'Missing or invalid `status` in request body.' },
            { status: 400 }
          )
        }

        const db = getServerConfig().db
        const ctx: DocumentLifecycleContext = {
          db,
          definition: config.definition,
          collectionId: config.collection.id,
          collectionPath: path,
        }

        try {
          const result = await changeDocumentStatus(ctx, {
            documentId: id,
            nextStatus,
            locale: 'en',
          })

          return Response.json({
            status: 'ok',
            previousStatus: result.previousStatus,
            newStatus: result.newStatus,
          })
        } catch (error) {
          if (error instanceof DocumentNotFoundError) {
            return Response.json({ error: 'Document not found' }, { status: 404 })
          }
          if (error instanceof InvalidTransitionError) {
            return Response.json(
              { error: 'Invalid status transition', reason: error.message },
              { status: 422 }
            )
          }
          throw error
        }
      },
    },
  },
})
