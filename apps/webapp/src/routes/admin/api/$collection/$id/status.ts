/**
 * This Source Code Form is subject to the terms of the Mozilla Public
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

import { getCollectionDefinition, getServerConfig } from '@byline/core'
import { getWorkflow, validateStatusTransition } from '@byline/core/workflow'

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

        // Get the current document to read its status.
        const latest = await db.queries.documents.getDocumentById({
          collection_id: config.collection.id,
          document_id: id,
          locale: 'en',
          reconstruct: false,
        })

        if (latest == null) {
          return Response.json({ error: 'Document not found' }, { status: 404 })
        }

        const currentStatus: string = (latest as any).status ?? 'draft'

        // Resolve the workflow for this collection and validate the transition.
        const collectionDef = getCollectionDefinition(path)
        if (collectionDef == null) {
          return Response.json({ error: 'Collection definition not found.' }, { status: 404 })
        }

        const workflow = getWorkflow(collectionDef)
        const result = validateStatusTransition(workflow, currentStatus, nextStatus)

        if (!result.valid) {
          return Response.json(
            { error: 'Invalid status transition', reason: result.reason },
            { status: 422 }
          )
        }

        // Mutate the status on the current version row.
        await db.commands.documents.setDocumentStatus({
          document_version_id: (latest as any).document_version_id,
          status: nextStatus,
        })

        // Auto-archive: when transitioning to 'published', archive ALL
        // previously published versions (excluding the one we just published)
        // so there can only ever be one published version at a time.
        if (nextStatus === 'published') {
          await db.commands.documents.archivePublishedVersions({
            document_id: id,
            excludeVersionId: (latest as any).document_version_id,
          })
        }

        return Response.json({
          status: 'ok',
          previousStatus: currentStatus,
          newStatus: nextStatus,
        })
      },
    },
  },
})
