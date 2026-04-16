import path from 'node:path'

import { createServerFn } from '@tanstack/react-start'

import type { BeforeUploadContext, StoredFileLocation, StoredFileValue } from '@byline/core'
import { deriveVariantStoragePaths, getServerConfig } from '@byline/core'
import { getLogger, withLogContext } from '@byline/core/logger'
import type { DocumentLifecycleContext } from '@byline/core/services'
import { createDocument } from '@byline/core/services'
import { extractImageMeta, generateImageVariants, isBypassMimeType } from '@byline/storage-local'

import { ensureCollection } from '@/lib/api-utils'

export interface UploadDocumentResult {
  /** Present when the upload endpoint created a document (createDocument=true, the default). */
  documentId?: string
  documentVersionId?: string
  storedFile: StoredFileValue
  variants: Array<{ name: string; url: string }>
}

interface UploadDocumentInput {
  collectionPath: string
  shouldCreateDocument: boolean
  file: File
  fields: Record<string, string>
}

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

function parseUploadFormData(data: FormData): UploadDocumentInput {
  if (!(data instanceof FormData)) {
    throw new Error('Expected FormData upload payload.')
  }

  const collectionEntry = data.get('collection')
  if (typeof collectionEntry !== 'string' || collectionEntry.trim() === '') {
    throw new Error("Missing required form field 'collection'.")
  }

  const fileEntry = data.get('file')
  if (!(fileEntry instanceof File)) {
    throw new Error("Missing required form field 'file'.")
  }

  const fields: Record<string, string> = {}
  for (const [key, value] of data.entries()) {
    if (key === 'collection' || key === 'createDocument' || key === 'file') {
      continue
    }
    if (typeof value === 'string') {
      fields[key] = value
    }
  }

  return {
    collectionPath: collectionEntry.trim(),
    shouldCreateDocument: data.get('createDocument') !== 'false',
    file: fileEntry,
    fields,
  }
}

/**
 * Temporary transport refactor note:
 * This upload path was moved from the lone TanStack file-route API endpoint into
 * a module-local server function so admin collection operations use one
 * consistent module-oriented calling pattern.
 *
 * This is still an interim shape. The upload orchestration below remains
 * framework-coupled and should be extracted next into a framework-agnostic
 * service that can be consumed equally by in-process adapters, remote adapters,
 * and any stable HTTP transport we introduce later.
 */
export const uploadCollectionDocument = createServerFn({ method: 'POST' })
  .inputValidator(parseUploadFormData)
  .handler(async ({ data }) => {
    const { collectionPath, shouldCreateDocument, file, fields } = data
    const logger = getLogger()

    return withLogContext(
      { domain: 'api', module: 'upload', function: 'uploadCollectionDocument' },
      async () => {
        const config = await ensureCollection(collectionPath)
        if (config == null) {
          throw new Error('Collection not found.')
        }

        const { upload } = config.definition
        if (!upload) {
          throw new Error(
            `Collection '${collectionPath}' is not upload-enabled. Add an 'upload' block to its CollectionDefinition.`
          )
        }

        const serverConfig = getServerConfig()
        const storage = upload.storage ?? serverConfig.storage
        if (!storage) {
          throw new Error(
            `No storage provider configured for collection '${collectionPath}'. Set either collection.upload.storage or the site-wide ServerConfig.storage.`
          )
        }

        const mimeType = file.type || 'application/octet-stream'
        const originalFilename = file.name || 'upload'
        const filename = sanitiseFilename(originalFilename)
        const fileSize = file.size

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

        if (upload.mimeTypes && upload.mimeTypes.length > 0) {
          if (!isMimeTypeAllowed(mimeType, upload.mimeTypes)) {
            throw new Error(
              `MIME type '${mimeType}' is not allowed for this collection. Allowed: ${upload.mimeTypes.join(', ')}.`
            )
          }
        }

        if (upload.maxFileSize && fileSize > upload.maxFileSize) {
          throw new Error(
            `File size ${fileSize} bytes exceeds the maximum allowed size of ${upload.maxFileSize} bytes.`
          )
        }

        let buffer: Buffer
        try {
          buffer = Buffer.from(await file.arrayBuffer())
        } catch (err: unknown) {
          logger.error({ err }, 'failed to read file buffer')
          throw new Error('Failed to read uploaded file.')
        }

        let storedFile: StoredFileLocation
        try {
          storedFile = await storage.upload(buffer, {
            filename,
            mimeType,
            size: fileSize,
            collection: collectionPath,
          })
        } catch (err: unknown) {
          logger.error({ err }, 'storage upload failed')
          throw new Error('File upload failed. See server logs for details.')
        }

        const imageMeta = await extractImageMeta(buffer, mimeType)

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
              upload.sizes,
              logger
            )
            variants = variantResults.map((variant) => ({
              name: variant.name,
              url: storage.getUrl(variant.storagePath),
            }))
            variantStoragePaths = variantResults.map((variant) => variant.storagePath)
          } catch (err: unknown) {
            logger.error({ err }, 'image variant generation failed')
          }
        }

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

        const storedFileValue: StoredFileValue = {
          file_id: crypto.randomUUID(),
          filename: effectiveFilename,
          original_filename: originalFilename,
          mime_type: mimeType,
          file_size: fileSize,
          storage_provider: storedFile.storage_provider,
          storage_path: storedFile.storage_path,
          storage_url: storedFile.storage_url ?? undefined,
          file_hash: undefined,
          image_width: imageMeta.width ?? undefined,
          image_height: imageMeta.height ?? undefined,
          image_format: imageMeta.format ?? undefined,
          processing_status: 'complete',
          thumbnail_generated: variants.some((variant) => variant.name === 'thumbnail'),
        }

        if (!shouldCreateDocument) {
          return { storedFile: storedFileValue, variants }
        }

        const documentData: Record<string, any> = {}
        for (const field of config.definition.fields) {
          if (field.type === 'image' || field.type === 'file') {
            documentData[field.name] = storedFileValue
            continue
          }

          const rawValue = fields[field.name]?.trim() ?? ''
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
          logger,
        }

        try {
          const result = await createDocument(ctx, {
            data: documentData,
            locale: 'en',
          })

          return {
            documentId: result.documentId,
            documentVersionId: result.documentVersionId,
            storedFile: storedFileValue,
            variants,
          }
        } catch (err: unknown) {
          logger.error({ err }, 'document creation failed — rolling back storage files')
          const allPaths = [
            storedFile.storage_path,
            ...deriveVariantStoragePaths(storedFile.storage_path, upload.sizes ?? []),
          ]
          for (const storagePath of allPaths) {
            try {
              await storage.delete(storagePath)
            } catch (cleanupErr: unknown) {
              logger.error({ err: cleanupErr, storagePath }, 'rollback: failed to delete file')
            }
          }
          throw new Error('File was stored but document creation failed. See server logs.')
        }
      }
    )
  })

/**
 * Upload a file to an upload-enabled collection.
 *
 * This preserves the existing client-side call signature while routing the
 * upload through the module-local TanStack Start server function above.
 *
 * @param collection      - collection path (e.g. `'media'`)
 * @param formData        - FormData with at minimum a `file` (File) field; may
 *                          also include `title`, `altText`, `caption`, `credit`,
 *                          `category`.
 * @param createDocument  - when `false`, the server stores the file and returns
 *                          the StoredFileValue but does NOT create a document
 *                          version. Use this when the upload is part of an
 *                          in-form field widget — the form's own save will
 *                          create the document. Defaults to `true`.
 */
export async function uploadDocument(
  collection: string,
  formData: FormData,
  createDocument = true
): Promise<UploadDocumentResult> {
  const payload = new FormData()
  for (const [key, value] of formData.entries()) {
    payload.append(key, value)
  }
  payload.set('collection', collection)
  payload.set('createDocument', createDocument ? 'true' : 'false')

  return uploadCollectionDocument({ data: payload })
}
