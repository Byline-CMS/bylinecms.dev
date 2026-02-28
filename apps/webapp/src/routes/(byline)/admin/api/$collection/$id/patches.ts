/**
 * This Source Code is subject to the terms of the Mozilla Public
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
import type { DocumentLifecycleContext } from '@byline/core/services'
import {
  ConflictError,
  DocumentNotFoundError,
  PatchApplicationError,
  updateDocumentWithPatches,
} from '@byline/core/services'

import { ensureCollection } from '@/lib/api-utils'

export const Route = createFileRoute('/(byline)/admin/api/$collection/$id/patches')({
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

        const body = (await request.json()) as {
          data: Record<string, any>
          patches: DocumentPatch[]
          document_version_id?: string
          locale?: string
        }
        const { patches, document_version_id, locale } = body

        const db = getServerConfig().db
        const ctx: DocumentLifecycleContext = {
          db,
          definition: config.definition,
          collectionId: config.collection.id,
          collectionPath: path,
        }

        try {
          await updateDocumentWithPatches(ctx, {
            documentId: id,
            patches,
            documentVersionId: document_version_id,
            locale: locale ?? 'en',
          })
        } catch (error) {
          if (error instanceof DocumentNotFoundError) {
            return Response.json({ error: 'Document not found' }, { status: 404 })
          }
          if (error instanceof ConflictError) {
            return Response.json(
              {
                error: 'Conflict',
                message: error.message,
                current_version_id: error.currentVersionId,
                your_version_id: error.yourVersionId,
              },
              { status: 409 }
            )
          }
          if (error instanceof PatchApplicationError) {
            console.warn('applyPatches failed', { errors: error.errors, patches })
            return Response.json(
              { error: 'Failed to apply patches', details: error.errors },
              { status: 400 }
            )
          }
          throw error
        }

        return Response.json({ status: 'ok' })
      },
    },
  },
})
