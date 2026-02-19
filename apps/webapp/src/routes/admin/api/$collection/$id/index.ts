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
 * API Route: GET /api/:collection/:id
 * API Route: PUT /api/:collection/:id
 * API Route: DELETE /api/:collection/:id
 *
 * CRUD operations for a specific document by ID in a collection.
 */

import { createFileRoute } from '@tanstack/react-router'

import { getServerConfig } from '@byline/core'

import { ensureCollection, normaliseDateFields } from '@/lib/api-utils'

export const Route = createFileRoute('/admin/api/$collection/$id/')({
  server: {
    handlers: {
      /**
       * GET /api/:collection/:id
       *
       * Get a specific document by ID from a collection.
       * Note: this expects a logical document_id, and not a document version ID.
       */
      GET: async ({ params }) => {
        const { collection: path, id } = params

        const config = await ensureCollection(path)
        if (config == null) {
          return Response.json(
            { error: 'Collection not found in registry or could not be created.' },
            { status: 404 }
          )
        }

        const db = getServerConfig().db

        const document = await db.queries.documents.getDocumentById({
          collection_id: config.collection.id,
          document_id: id,
          locale: 'en',
        })

        if (document == null) {
          return Response.json({ error: 'Document not found' }, { status: 404 })
        }

        return Response.json({ document })
      },

      /**
       * PUT /api/:collection/:id
       *
       * Update a specific document by ID in a collection.
       * Expects the updated document data in the request body.
       *
       * NOTE: In our new immutable 'versioning-by-default' document model,
       * this will create a new version of the document.
       */
      PUT: async ({ request, params }) => {
        const { collection: path, id } = params

        const config = await ensureCollection(path)
        if (config == null) {
          return Response.json(
            { error: 'Collection not found in registry or could not be created.' },
            { status: 404 }
          )
        }

        const documentData = structuredClone(await request.json())

        // TODO: Validate the documentData against the collection schema and
        // coerce values to the correct types.
        normaliseDateFields(documentData)

        const db = getServerConfig().db

        // Lifecycle: beforeUpdate
        if (config.definition.hooks?.beforeUpdate) {
          await config.definition.hooks.beforeUpdate({
            data: documentData,
            originalData: documentData, // PUT replaces wholesale — no separate original
            collectionPath: path,
          })
        }

        await db.commands.documents.createDocumentVersion({
          documentId: id,
          collectionId: config.collection.id,
          collectionConfig: config.definition,
          action: 'update',
          documentData,
          path: documentData.path,
          status: documentData.status,
          locale: 'en',
        })

        // Lifecycle: afterUpdate
        if (config.definition.hooks?.afterUpdate) {
          await config.definition.hooks.afterUpdate({
            data: documentData,
            originalData: documentData,
            collectionPath: path,
          })
        }

        return Response.json({ status: 'ok' })
      },

      /**
       * DELETE /api/:collection/:id
       *
       * Delete a specific document by ID in a collection.
       *
       * NOTE: In our new immutable 'versioning-by-default' document
       * model, this will create a new version of the document with
       * is_deleted set to 'true'.
       *
       * TODO: Re-implement with our new queries and commands
       */
      DELETE: async ({ params }) => {
        const { collection: path } = params

        const config = await ensureCollection(path)
        if (config == null) {
          return Response.json(
            { error: 'Collection not found in registry or could not be created.' },
            { status: 404 }
          )
        }

        // TODO: Re-implement with our new queries and commands
        return Response.json({ status: 'not implemented' }, { status: 501 })
      },
    },
  },
})
