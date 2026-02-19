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
 * API Route: GET /api/:collection
 *
 * Get documents from a collection by page.
 * Defaults to page 1 and page size of 20.
 *
 * API Route: POST /api/:collection
 *
 * Create a new document in a collection.
 * Expects the document data in the request body.
 */

import { createFileRoute } from '@tanstack/react-router'

import { getServerConfig } from '@byline/core'

import { collectionListSchema, ensureCollection, normaliseDateFields } from '@/lib/api-utils'

export const Route = createFileRoute('/admin/api/$collection/')({
  server: {
    handlers: {
      /**
       * GET /api/:collection
       *
       * Get documents from a collection by page.
       * Defaults to page 1 and page size of 20.
       */
      GET: async ({ request, params }) => {
        const { collection: path } = params

        const config = await ensureCollection(path)
        if (config == null) {
          return Response.json(
            { error: 'Collection not found in registry or could not be created.' },
            { status: 404 }
          )
        }

        const parsed = collectionListSchema.safeParse(
          Object.fromEntries(new URL(request.url).searchParams)
        )

        if (!parsed.success) {
          return Response.json(
            { error: 'Invalid query parameters', issues: parsed.error.issues },
            { status: 400 }
          )
        }

        const db = getServerConfig().db

        const result = await db.queries.documents.getDocumentsByPage({
          collection_id: config.collection.id,
          locale: 'en',
          ...parsed.data,
        })

        return Response.json(result)
      },

      /**
       * POST /api/:collection
       *
       * Create a new document in a collection.
       * Expects the document data in the request body.
       */
      POST: async ({ request, params }) => {
        const { collection: path } = params

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

        // Lifecycle: beforeCreate
        if (config.definition.hooks?.beforeCreate) {
          await config.definition.hooks.beforeCreate({
            data: documentData,
            collectionPath: path,
          })
        }

        // Ensure path is present. If not, generate one from title or random UUID.
        if (!documentData.path) {
          if (documentData.title) {
            documentData.path = documentData.title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/(^-|-$)+/g, '')
          } else {
            documentData.path = crypto.randomUUID()
          }
        }

        const db = getServerConfig().db

        await db.commands.documents.createDocumentVersion({
          collectionId: config.collection.id,
          collectionConfig: config.definition,
          action: 'create',
          documentData,
          path: documentData.path,
          status: documentData.status,
          locale: 'en',
        })

        // Lifecycle: afterCreate
        if (config.definition.hooks?.afterCreate) {
          await config.definition.hooks.afterCreate({
            data: documentData,
            collectionPath: path,
          })
        }

        return Response.json({ status: 'ok' })
      },
    },
  },
})
