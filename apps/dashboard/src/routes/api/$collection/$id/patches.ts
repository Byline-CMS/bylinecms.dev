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
 * API Route: POST /api/:collection/:id/patches
 *
 * Apply a set of patches to a document in a collection.
 * This is a prototype of our patch-based document update system.
 */

import { createFileRoute } from '@tanstack/react-router'

import { getServerConfig } from '@byline/core'
import type { DocumentPatch } from '@byline/core/patches'
import { applyPatches } from '@byline/core/patches'

import { ensureCollection, normaliseDateFields } from '@/lib/api-utils'

export const Route = createFileRoute('/api/$collection/$id/patches')({
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

        await db.commands.documents.createDocumentVersion({
          documentId: id,
          collectionId: config.collection.id,
          collectionConfig: config.definition,
          action: 'update',
          documentData: nextData,
          path: nextData.path ?? originalData.path ?? '/',
          status: nextData.status ?? originalData.status ?? 'draft',
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
