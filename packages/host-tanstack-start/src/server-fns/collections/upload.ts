import { createServerFn } from '@tanstack/react-start'

import type {
  CollectionDefinition,
  FieldUploadContext,
  FileField,
  ImageField,
  StoredFileValue,
} from '@byline/core'
import { ERR_NOT_FOUND, ERR_VALIDATION, getServerConfig, getUploadFields } from '@byline/core'
import { getLogger, withLogContext } from '@byline/core/logger'
import { uploadField as coreUploadField } from '@byline/core/services'
import { extractImageMeta, generateImageVariants, isBypassMimeType } from '@byline/storage-local'

import { getAdminRequestContext } from '../../auth/auth-context.js'
import { ensureCollection } from '../../integrations/api-utils.js'

/**
 * Result of an upload through the host transport. The legacy top-level
 * `variants: { name, url }[]` is gone — variants live on
 * `storedFile.variants` with full `storagePath`/`storageUrl`/`width`/
 * `height`/`format`. Single source of truth.
 */
export interface UploadFieldResult {
  /** Present when the upload endpoint created a document (createDocument=true, the default). */
  documentId?: string
  documentVersionId?: string
  storedFile: StoredFileValue
}

interface UploadDocumentInput {
  collectionPath: string
  shouldCreateDocument: boolean
  /**
   * Name of the upload-capable image/file field on the collection. When
   * absent, the handler defaults to the unique upload-capable field;
   * collections with multiple upload-capable fields require an explicit
   * `field` selector.
   */
  fieldName: string | null
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

  const fieldEntry = data.get('field')
  const fieldName = typeof fieldEntry === 'string' && fieldEntry.trim() ? fieldEntry.trim() : null

  const fields: Record<string, string> = {}
  for (const [key, value] of data.entries()) {
    if (key === 'collection' || key === 'createDocument' || key === 'file' || key === 'field') {
      continue
    }
    if (typeof value === 'string') {
      fields[key] = value
    }
  }

  return {
    collectionPath: collectionEntry.trim(),
    shouldCreateDocument: data.get('createDocument') !== 'false',
    fieldName,
    file: fileEntry,
    fields,
  }
}

/**
 * Resolve the target upload field on the collection. Explicit `field`
 * wins; otherwise default to the unique upload-capable field. Throws
 * `ERR_VALIDATION` when the request is ambiguous.
 *
 * Walks `definition.fields` only (not nested `group` / `array` /
 * `blocks`) — top-level upload fields are the supported case for the
 * transport today. Nested-field uploads remain available via the core
 * service when wired into a custom transport.
 */
function resolveUploadFieldName(
  definition: CollectionDefinition,
  collectionPath: string,
  requested: string | null
): string {
  const candidates = getUploadFields(definition)

  if (requested) {
    const match = candidates.find((f) => f.name === requested)
    if (!match) {
      throw ERR_VALIDATION({
        message:
          `Field '${requested}' is not an upload-capable image/file field on collection ` +
          `'${collectionPath}'.`,
        details: {
          collectionPath,
          requestedField: requested,
          available: candidates.map((f) => f.name),
        },
      })
    }
    return match.name
  }

  if (candidates.length === 1) return candidates[0].name

  if (candidates.length === 0) {
    throw ERR_VALIDATION({
      message:
        `Collection '${collectionPath}' has no upload-capable image/file field. ` +
        "Add an 'upload' block to one of its image/file fields.",
      details: { collectionPath },
    })
  }

  throw ERR_VALIDATION({
    message:
      `Collection '${collectionPath}' has multiple upload-capable fields ` +
      `(${candidates.map((f) => `'${f.name}'`).join(', ')}). ` +
      "Pass a 'field' FormData entry to select one.",
    details: {
      collectionPath,
      available: candidates.map((f) => f.name),
    },
  })
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
export const uploadCollectionField = createServerFn({ method: 'POST' })
  .inputValidator(parseUploadFormData)
  .handler(async ({ data }) => {
    const { collectionPath, shouldCreateDocument, fieldName, file, fields } = data
    const logger = getLogger()

    return withLogContext(
      { domain: 'api', module: 'upload', function: 'uploadCollectionField' },
      async () => {
        const config = await ensureCollection(collectionPath)
        if (config == null) {
          throw ERR_NOT_FOUND(
            {
              message: 'Collection not found.',
              details: { collectionPath },
            },
            uploadCollectionField
          ).log(logger)
        }

        const serverConfig = getServerConfig()
        const resolvedFieldName = resolveUploadFieldName(
          config.definition,
          collectionPath,
          fieldName
        )
        const targetField = config.definition.fields.find((f) => f.name === resolvedFieldName) as
          | ImageField
          | FileField
        // Per-field storage routing falls through to the site-wide default.
        const storage = targetField.upload?.storage ?? serverConfig.storage
        if (!storage) {
          throw new Error(
            `No storage provider configured for field '${resolvedFieldName}' on collection ` +
              `'${collectionPath}'. Set either field.upload.storage or the site-wide ` +
              'ServerConfig.storage.'
          )
        }

        let buffer: Buffer
        try {
          buffer = Buffer.from(await file.arrayBuffer())
        } catch (err: unknown) {
          logger.error({ err, collectionPath }, 'failed to read file buffer')
          throw new Error('Failed to read uploaded file.')
        }

        const ctx: FieldUploadContext = {
          db: serverConfig.db,
          definition: config.definition,
          collectionId: config.collection.id,
          collectionVersion: config.collection.version,
          collectionPath,
          fieldName: resolvedFieldName,
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

        return coreUploadField(ctx, {
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
export async function uploadField(
  collection: string,
  formData: FormData,
  createDocument = true
): Promise<UploadFieldResult> {
  const payload = new FormData()
  for (const [key, value] of formData.entries()) {
    payload.append(key, value)
  }

  payload.set('collection', collection)
  payload.set('createDocument', createDocument ? 'true' : 'false')

  return uploadCollectionField({ data: payload })
}
