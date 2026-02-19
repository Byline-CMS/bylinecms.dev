/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
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
