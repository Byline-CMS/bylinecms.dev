/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
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
import type { DocumentLifecycleContext } from '@byline/core/services'
import { deleteDocument, updateDocument } from '@byline/core/services'

import { ensureCollection } from '@/lib/api-utils'

export const Route = createFileRoute('/admin/api/$collection/$id/')({
  server: {
    handlers: {
      /**
       * GET /api/:collection/:id
       * GET /api/:collection/:id?version_id=<document_version_id>
       *
       * Get a specific document by ID from a collection.
       * When `version_id` is provided, fetches that specific historical version
       * instead of the current (latest) version.
       * Note: the `id` param is the logical document_id, not a document version ID.
       */
      GET: async ({ request, params }) => {
        const { collection: path, id } = params
        const { searchParams } = new URL(request.url)
        const versionId = searchParams.get('version_id')

        const config = await ensureCollection(path)
        if (config == null) {
          return Response.json(
            { error: 'Collection not found in registry or could not be created.' },
            { status: 404 }
          )
        }

        const db = getServerConfig().db

        // When version_id is supplied, fetch that specific historical version
        // directly from document_versions (bypasses the current_documents view).
        if (versionId) {
          const document = await db.queries.documents.getDocumentByVersion({
            document_version_id: versionId,
            locale: 'en',
          })
          if (document == null) {
            return Response.json({ error: 'Document version not found' }, { status: 404 })
          }
          return Response.json({ document })
        }

        const document = await db.queries.documents.getDocumentById({
          collection_id: config.collection.id,
          document_id: id,
          locale: 'en',
        })

        if (document == null) {
          return Response.json({ error: 'Document not found' }, { status: 404 })
        }

        // If the current version is not published, check whether a published
        // version exists behind it so the UI can show a "published is live" badge.
        let publishedVersion: {
          document_version_id: string
          document_id: string
          status: string
          created_at: Date
          updated_at: Date
        } | null = null

        if ((document as any).status !== 'published') {
          publishedVersion = await db.queries.documents.getPublishedVersion({
            collection_id: config.collection.id,
            document_id: id,
          })
        }

        return Response.json({ document, publishedVersion })
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

        const db = getServerConfig().db
        const ctx: DocumentLifecycleContext = {
          db,
          definition: config.definition,
          collectionId: config.collection.id,
          collectionPath: path,
        }

        await updateDocument(ctx, {
          documentId: id,
          data: documentData,
          locale: 'en',
        })

        return Response.json({ status: 'ok' })
      },

      /**
       * DELETE /api/:collection/:id
       *
       * Soft-delete a document by marking all of its versions as deleted.
       * The document disappears from listings but data is preserved.
       */
      DELETE: async ({ params }) => {
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

        try {
          const result = await deleteDocument(ctx, { documentId: id })
          return Response.json({
            status: 'ok',
            deletedVersionCount: result.deletedVersionCount,
          })
        } catch (err: any) {
          if (err.name === 'DocumentNotFoundError') {
            return Response.json({ error: 'Document not found' }, { status: 404 })
          }
          return Response.json(
            { error: err.message || 'Failed to delete document' },
            { status: 500 }
          )
        }
      },
    },
  },
})
