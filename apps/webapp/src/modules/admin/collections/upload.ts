import { createServerFn } from '@tanstack/react-start'

import type { DocumentUploadContext, StoredFileValue } from '@byline/core'
import { ERR_NOT_FOUND, getServerConfig } from '@byline/core'
import { getLogger, withLogContext } from '@byline/core/logger'
import { uploadDocument as coreUploadDocument } from '@byline/core/services'
import { extractImageMeta, generateImageVariants, isBypassMimeType } from '@byline/storage-local'

import { ensureCollection } from '@/lib/api-utils'
import { getAdminRequestContext } from '@/lib/auth-context'

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
 * This upload path now uses a module-local TanStack server function as a thin
 * transport wrapper around the framework-agnostic core upload service.
 *
 * This is still an interim transport shape. The next architectural step is to
 * add a stable HTTP upload transport backed by the same core service so remote
 * deployments and external clients can use the identical upload orchestration
 * without depending on TanStack Start server-function transport details.
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
          throw ERR_NOT_FOUND(
            {
              message: 'Collection not found.',
              details: { collectionPath },
            },
            uploadCollectionDocument
          ).log(logger)
        }

        const serverConfig = getServerConfig()
        const storage = config.definition.upload?.storage ?? serverConfig.storage
        if (!storage) {
          throw new Error(
            `No storage provider configured for collection '${collectionPath}'. Set either collection.upload.storage or the site-wide ServerConfig.storage.`
          )
        }

        let buffer: Buffer
        try {
          buffer = Buffer.from(await file.arrayBuffer())
        } catch (err: unknown) {
          logger.error({ err, collectionPath }, 'failed to read file buffer')
          throw new Error('Failed to read uploaded file.')
        }

        const ctx: DocumentUploadContext = {
          db: serverConfig.db,
          definition: config.definition,
          collectionId: config.collection.id,
          collectionVersion: config.collection.version,
          collectionPath,
          storage,
          logger,
          defaultLocale: serverConfig.i18n.content.defaultLocale,
          slugifier: serverConfig.slugifier,
          requestContext: await getAdminRequestContext(),
          imageProcessor: {
            extractMeta: extractImageMeta,
            isBypassMimeType,
            generateVariants: async ({ buffer, mimeType, storedFile, storage, upload, logger }) => {
              if (!('uploadDir' in storage) || typeof (storage as any).uploadDir !== 'string') {
                return []
              }

              const uploadDir = (storage as any).uploadDir as string
              const absoluteOriginalPath = `${uploadDir}/${storedFile.storagePath}`

              return generateImageVariants(
                buffer,
                mimeType,
                absoluteOriginalPath,
                uploadDir,
                upload.sizes ?? [],
                logger
              )
            },
          },
        }

        return coreUploadDocument(ctx, {
          buffer,
          originalFilename: file.name || 'upload',
          mimeType: file.type || 'application/octet-stream',
          fileSize: file.size,
          fields,
          shouldCreateDocument,
          locale: serverConfig.i18n.content.defaultLocale,
        })
      }
    )
  })

/**
 * Upload a file to an upload-enabled collection.
 *
 * This preserves the existing client-side call signature while routing the
 * upload through the module-local TanStack Start server function above.
 *
 * @param collection      - collection path (e.g. 'media')
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
