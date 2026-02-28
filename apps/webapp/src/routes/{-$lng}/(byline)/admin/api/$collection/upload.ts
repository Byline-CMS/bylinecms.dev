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
 * Upload a file to an upload-enabled collection. On success the file is
 * stored via the resolved IStorageProvider, image variants are generated
 * via Sharp (where applicable), and a new document version is created in
 * the collection with the file metadata embedded in the primary image/file
 * field.
 *
 * The collection must have an `upload` config block in its `CollectionDefinition`.
 * Returns 405 Method Not Allowed for collections without `upload` configured.
 *
 * Query parameters:
 *   - `createDocument` (boolean, default `true`) — when `false` the file is
 *     stored and variants generated but no document version is created.
 *     Use this from embedded image/file field widgets in collection forms.
 *
 * Request: multipart/form-data
 *   - `file`       (File)   — binary file to upload           [required]
 *   - `title`      (string) — human title for the document    [optional; falls back to filename]
 *   - `altText`    (string) — alt text (image collections)    [optional]
 *   - `caption`    (string) — caption text                    [optional]
 *   - `credit`     (string) — photographer / attribution      [optional]
 *   - `category`   (string) — category select value           [optional]
 *
 * Response 201 (createDocument=true):  { documentId, documentVersionId, storedFile, variants }
 * Response 201 (createDocument=false): { storedFile, variants }
 * Response 400: { error: string }
 * Response 404: collection not found
 * Response 405: collection is not upload-enabled
 * Response 413: file exceeds maxFileSize
 * Response 415: MIME type not allowed
 */

import path from 'node:path'

import { createFileRoute } from '@tanstack/react-router'

import type { BeforeUploadContext, StoredFileLocation } from '@byline/core'
import { deriveVariantStoragePaths, getServerConfig } from '@byline/core'
import type { DocumentLifecycleContext } from '@byline/core/services'
import { createDocument } from '@byline/core/services'
import { extractImageMeta, generateImageVariants, isBypassMimeType } from '@byline/storage-local'

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

export const Route = createFileRoute('/{-$lng}/(byline)/admin/api/$collection/upload')({
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

        // Check whether the caller wants a document created automatically.
        // When this endpoint is called from an embedded image/file field
        // (ImageUploadField) within a document creation/edit form, passing
        // `?createDocument=false` skips automatic document creation — the
        // form's own save action is responsible for document persistence.
        const url = new URL(request.url)
        const shouldCreateDocument = url.searchParams.get('createDocument') !== 'false'

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
        // Collection-level upload.storage takes precedence over the site-wide
        // ServerConfig.storage default. This lets different collections target
        // different backends (e.g. local for avatars, S3 for editorial images).
        const serverConfig = getServerConfig()
        const storage = upload.storage ?? serverConfig.storage
        if (!storage) {
          return Response.json(
            {
              error:
                `No storage provider configured for collection '${collectionPath}'. ` +
                'Set either collection.upload.storage or the site-wide ServerConfig.storage.',
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

        // 5. Invoke beforeUpload hooks.
        //    Hooks may return a modified filename string to override the
        //    sanitised default (e.g. a slug-based or content-hash-based name).
        let effectiveFilename = filename
        const beforeUploadHook = config.definition.hooks?.beforeUpload
        if (beforeUploadHook) {
          const fns = Array.isArray(beforeUploadHook) ? beforeUploadHook : [beforeUploadHook]
          const hookCtx: BeforeUploadContext = { filename, mimeType, fileSize, collectionPath }
          for (const fn of fns) {
            const override = await fn(hookCtx)
            if (typeof override === 'string' && override.trim()) {
              effectiveFilename = override.trim()
            }
          }
        }

        // 6. Validate MIME type against the upload config.
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

        // 7. Read file into buffer (needed for metadata + variants).
        let buffer: Buffer
        try {
          buffer = Buffer.from(await file.arrayBuffer())
        } catch (err: unknown) {
          console.error('[upload] Failed to read file buffer:', err)
          return Response.json({ error: 'Failed to read uploaded file.' }, { status: 500 })
        }

        // 8. Upload original file via storage provider.
        let storedFile: StoredFileLocation
        try {
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

        // 9. Extract image metadata (dimensions, format).
        const imageMeta = await extractImageMeta(buffer, mimeType)

        // 10. Generate image variants via Sharp (skip for SVG/GIF).
        //     Only runs when: the collection defines `sizes`, the storage
        //     provider exposes an `uploadDir` (i.e. local provider), and the
        //     file is a processable image type.
        let variants: Array<{ name: string; url: string }> = []
        let variantStoragePaths: string[] = []
        const isProcessableImage = mimeType.startsWith('image/') && !isBypassMimeType(mimeType)

        if (
          isProcessableImage &&
          upload.sizes &&
          upload.sizes.length > 0 &&
          'uploadDir' in storage &&
          typeof (storage as any).uploadDir === 'string'
        ) {
          try {
            const uploadDir = (storage as any).uploadDir as string
            const absoluteOriginalPath = path.join(uploadDir, storedFile.storage_path)
            const variantResults = await generateImageVariants(
              buffer,
              mimeType,
              absoluteOriginalPath,
              uploadDir,
              upload.sizes
            )
            variants = variantResults.map((v) => ({
              name: v.name,
              url: storage.getUrl(v.storagePath),
            }))
            variantStoragePaths = variantResults.map((v) => v.storagePath)
          } catch (err: unknown) {
            console.error('[upload] Image variant generation failed:', err)
            // Non-fatal: continue without variants.
          }
        }

        // 11. Invoke afterUpload hooks.
        const afterUploadHook = config.definition.hooks?.afterUpload
        if (afterUploadHook) {
          const fns = Array.isArray(afterUploadHook) ? afterUploadHook : [afterUploadHook]
          for (const fn of fns) {
            await fn({
              storedFilePath: storedFile.storage_path,
              variantPaths: variantStoragePaths,
              collectionPath,
            })
          }
        }

        // 12. Build the StoredFileValue for the primary image/file field.
        const storedFileValue = {
          file_id: crypto.randomUUID(),
          filename: effectiveFilename,
          original_filename: originalFilename,
          mime_type: mimeType,
          file_size: String(fileSize),
          storage_provider: storedFile.storage_provider,
          storage_path: storedFile.storage_path,
          storage_url: storedFile.storage_url,
          file_hash: null,
          image_width: imageMeta.width,
          image_height: imageMeta.height,
          image_format: imageMeta.format,
          processing_status: 'complete' as const,
          thumbnail_generated: variants.some((v) => v.name === 'thumbnail'),
        }

        // 13. Optionally create a document version.
        //     Skipped when `?createDocument=false` is present (e.g. when the
        //     upload is triggered by an embedded image field in a form — the
        //     form submission will create the document with all field data).
        if (!shouldCreateDocument) {
          return Response.json({ storedFile: storedFileValue, variants }, { status: 201 })
        }

        // 14. Assemble document data generically from the collection's field definitions.
        //     On failure: roll back by deleting the stored file and any variants
        //     so we don't leave orphaned files in storage.
        //
        //     - image/file fields → populated from the StoredFileValue.
        //     - 'title' → read from form data; falls back to effectiveFilename so the
        //       document always has a usable label even when the caller omits it.
        //     - all other fields → read from form data by field name; omitted when empty.
        const documentData: Record<string, any> = {}
        for (const field of config.definition.fields) {
          if (field.type === 'image' || field.type === 'file') {
            documentData[field.name] = storedFileValue
            continue
          }
          const rawValue = (formData.get(field.name) as string | null)?.trim() ?? ''
          if (field.name === 'title') {
            documentData.title = rawValue || effectiveFilename
          } else if (rawValue !== '') {
            documentData[field.name] = rawValue
          }
        }

        const ctx: DocumentLifecycleContext = {
          db: serverConfig.db,
          definition: config.definition,
          collectionId: config.collection.id,
          collectionPath,
          storage,
        }

        let documentId: string
        let documentVersionId: string
        try {
          const result = await createDocument(ctx, {
            data: documentData,
            locale: 'en',
          })
          documentId = result.documentId
          documentVersionId = result.documentVersionId
        } catch (err: unknown) {
          console.error('[upload] Document creation failed — rolling back storage files:', err)
          // Roll back: remove original file and any generated variants.
          const allPaths = [
            storedFile.storage_path,
            ...deriveVariantStoragePaths(storedFile.storage_path, upload.sizes ?? []),
          ]
          for (const p of allPaths) {
            try {
              await storage.delete(p)
            } catch (cleanupErr: unknown) {
              console.error(`[upload] Rollback: failed to delete '${p}':`, cleanupErr)
            }
          }
          return Response.json(
            { error: 'File was stored but document creation failed. See server logs.' },
            { status: 500 }
          )
        }

        return Response.json(
          {
            documentId,
            documentVersionId,
            storedFile: storedFileValue,
            variants,
          },
          { status: 201 }
        )
      },
    },
  },
})
