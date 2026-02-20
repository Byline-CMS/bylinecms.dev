/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * API Route: POST /api/:collection/:id/patches
 *
 * Apply a set of patches to a document in a collection.
 * This is a prototype of our patch-based document update system.
 */

import { createFileRoute } from '@tanstack/react-router'

import { getServerConfig } from '@byline/core'
import type { DocumentPatch } from '@byline/core/patches'
import { applyPatches } from '@byline/core/patches'
import { getDefaultStatus } from '@byline/core/workflow'

import { ensureCollection, normaliseDateFields } from '@/lib/api-utils'

export const Route = createFileRoute('/admin/api/$collection/$id/patches')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { collection: path, id } = params

        const config = await ensureCollection(path)
        if (config == null) {
          return Response.json(
            { error: 'Collection not found in registry or could not be created.' },
            { status: 404 }
          )
        }

        const db = getServerConfig().db

        // Get the current document, reconstructed from field values so we always
        // have a complete object including title, summary, content, etc.
        const latest = await db.queries.documents.getDocumentById({
          collection_id: config.collection.id,
          document_id: id,
          locale: 'en',
          reconstruct: true,
        })

        if (latest == null) {
          return Response.json({ error: 'Document not found' }, { status: 404 })
        }

        const originalData = latest as Record<string, any>

        const body = (await request.json()) as {
          data: Record<string, any>
          patches: DocumentPatch[]
          document_version_id?: string
        }
        const { patches, document_version_id } = body

        // Optimistic concurrency: if the client specifies the version it based
        // its patches on, verify it is still the current version. A mismatch
        // means another write happened since the client loaded the document.
        if (document_version_id && document_version_id !== originalData.document_version_id) {
          return Response.json(
            {
              error: 'Conflict',
              message:
                'The document has been modified since you loaded it. Please refresh and try again.',
              current_version_id: originalData.document_version_id,
              your_version_id: document_version_id,
            },
            { status: 409 }
          )
        }

        // Apply patches to the reconstructed database version to create the next version.
        const { doc: patchedDocument, errors } = applyPatches(
          config.definition,
          originalData,
          patches
        )

        if (errors.length > 0) {
          console.warn('applyPatches failed', { errors, originalData, patches })
          return Response.json(
            { error: 'Failed to apply patches', details: errors },
            { status: 400 }
          )
        }

        // Treat the patched doc as a plain record for now.
        const nextData = patchedDocument as Record<string, any>

        // Normalise known date-like fields to Date instances before persisting,
        // mirroring the behaviour in the generic POST/PUT handlers.
        normaliseDateFields(nextData)

        // Lifecycle: beforeUpdate
        if (config.definition.hooks?.beforeUpdate) {
          await config.definition.hooks.beforeUpdate({
            data: nextData,
            originalData,
            collectionPath: path,
          })
        }

        // New versions always start at the collection's default status (typically
        // 'draft'). This preserves any previously published version so that the
        // published content remains live until the editor explicitly re-publishes.
        const defaultStatus = getDefaultStatus(config.definition)

        await db.commands.documents.createDocumentVersion({
          documentId: id,
          collectionId: config.collection.id,
          collectionConfig: config.definition,
          action: 'update',
          documentData: nextData,
          path: nextData.path ?? originalData.path ?? '/',
          status: defaultStatus,
          locale: 'en',
        })

        // Lifecycle: afterUpdate
        if (config.definition.hooks?.afterUpdate) {
          await config.definition.hooks.afterUpdate({
            data: nextData,
            originalData,
            collectionPath: path,
          })
        }

        return Response.json({ status: 'ok' })
      },
    },
  },
})
