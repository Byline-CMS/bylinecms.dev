/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * API Route: POST /admin/api/:collection/upload
 *
 * Upload a file to an upload-enabled collection.
 *
 * The collection must have an `upload` config block in its `CollectionDefinition`.
 * Returns 405 Method Not Allowed for collections without `upload` configured.
 *
 * Request: multipart/form-data
 *   - `file`  (File)     — the binary file to upload  [required]
 *   - `title` (string)   — human title for the media document [optional; falls back to filename]
 *
 * Response 201: { documentId, storedFile: StoredFileLocation }
 * Response 400: { error: string }
 * Response 404: collection not found
 * Response 405: collection is not upload-enabled
 * Response 413: file exceeds maxFileSize
 * Response 415: MIME type not allowed
 */

import { createFileRoute } from '@tanstack/react-router'

import type { StoredFileLocation } from '@byline/core'
import { getServerConfig } from '@byline/core'

import { ensureCollection } from '@/lib/api-utils'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Test whether a concrete MIME type is matched by an allowed-types list that
 * may contain wildcards (e.g. `'image/*'`).
 */
function isMimeTypeAllowed(mimeType: string, allowedTypes: string[]): boolean {
  return allowedTypes.some((allowed) => {
    if (allowed === '*/*') return true
    if (allowed.endsWith('/*')) {
      const prefix = allowed.slice(0, -2)
      return mimeType.startsWith(`${prefix}/`)
    }
    return allowed === mimeType
  })
}

/**
 * Sanitise a filename for safe storage.
 * Lowercases, strips unsafe characters, collapses hyphens.
 */
function sanitiseFilename(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  const ext = lastDot !== -1 ? filename.slice(lastDot).toLowerCase() : ''
  const base = lastDot !== -1 ? filename.slice(0, lastDot) : filename
  const safe = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `${safe || 'file'}${ext}`
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/admin/api/$collection/upload')({
  server: {
    handlers: {
      /**
       * POST /admin/api/:collection/upload
       *
       * Accepts a multipart/form-data body.
       * The `file` field must contain the binary file to upload.
       */
      POST: async ({ request, params }) => {
        const { collection: collectionPath } = params

        // 1. Resolve collection definition.
        const config = await ensureCollection(collectionPath)
        if (config == null) {
          return Response.json({ error: 'Collection not found.' }, { status: 404 })
        }

        // 2. Guard: must be an upload-enabled collection.
        const { upload } = config.definition
        if (!upload) {
          return Response.json(
            {
              error: `Collection '${collectionPath}' is not upload-enabled. Add an 'upload' block to its CollectionDefinition.`,
            },
            { status: 405 }
          )
        }

        // 3. Resolve storage provider.
        const serverConfig = getServerConfig()
        const storage = serverConfig.storage
        if (!storage) {
          return Response.json(
            {
              error:
                'No storage provider configured. Add a storage provider to ServerConfig (e.g. localStorageProvider).',
            },
            { status: 500 }
          )
        }

        // 4. Parse multipart form data.
        let formData: FormData
        try {
          formData = await request.formData()
        } catch {
          return Response.json(
            {
              error:
                'Failed to parse multipart form data. Ensure Content-Type is multipart/form-data.',
            },
            { status: 400 }
          )
        }

        const fileEntry = formData.get('file')
        if (!fileEntry || !(fileEntry instanceof File)) {
          return Response.json({ error: "Missing required form field 'file'." }, { status: 400 })
        }

        const file = fileEntry as File
        const mimeType = file.type || 'application/octet-stream'
        const originalFilename = file.name || 'upload'
        const filename = sanitiseFilename(originalFilename)
        const fileSize = file.size

        // 5. Validate MIME type against the upload config.
        if (upload.mimeTypes && upload.mimeTypes.length > 0) {
          if (!isMimeTypeAllowed(mimeType, upload.mimeTypes)) {
            return Response.json(
              {
                error: `MIME type '${mimeType}' is not allowed for this collection. Allowed: ${upload.mimeTypes.join(', ')}.`,
              },
              { status: 415 }
            )
          }
        }

        // 6. Validate file size.
        if (upload.maxFileSize && fileSize > upload.maxFileSize) {
          return Response.json(
            {
              error: `File size ${fileSize} bytes exceeds the maximum allowed size of ${upload.maxFileSize} bytes.`,
            },
            { status: 413 }
          )
        }

        // 7. Convert to Buffer and upload via the storage provider.
        let storedFile: StoredFileLocation
        try {
          const arrayBuffer = await file.arrayBuffer()
          const buffer = Buffer.from(arrayBuffer)

          storedFile = await storage.upload(buffer, {
            filename,
            mimeType,
            size: fileSize,
            collection: collectionPath,
          })
        } catch (err: unknown) {
          console.error('[upload] Storage upload failed:', err)
          return Response.json(
            { error: 'File upload failed. See server logs for details.' },
            { status: 500 }
          )
        }

        // 8. Return the stored file location.
        // TODO: In a subsequent step this will also create a document version
        // in the collection (via createDocumentVersion), associating the
        // StoredFileLocation with the primary image/file field, and return the
        // new documentId alongside the file metadata.
        return Response.json(
          {
            storedFile,
            filename,
            originalFilename,
            mimeType,
            fileSize,
          },
          { status: 201 }
        )
      },
    },
  },
})
