/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { normalizeCollectionHook } from '../@types/index.js'
import { ERR_DATABASE, ERR_STORAGE, ERR_VALIDATION } from '../lib/errors.js'
import { withLogContext } from '../lib/logger.js'
import { createDocument, type DocumentLifecycleContext } from './document-lifecycle.js'
import type {
  BeforeUploadContext,
  CollectionDefinition,
  IDbAdapter,
  IStorageProvider,
  StoredFileLocation,
  StoredFileValue,
  UploadConfig,
} from '../@types/index.js'
import type { BylineLogger } from '../lib/logger.js'
import type { SlugifierFn } from '../utils/slugify.js'

export interface UploadImageMeta {
  width: number | null
  height: number | null
  format: string | null
}

export interface UploadVariantResult {
  name: string
  storagePath: string
}

export interface UploadImageProcessor {
  extractMeta: (buffer: Buffer, mimeType: string) => Promise<UploadImageMeta>
  isBypassMimeType?: (mimeType: string) => boolean
  generateVariants?: (params: {
    buffer: Buffer
    mimeType: string
    storedFile: StoredFileLocation
    storage: IStorageProvider
    upload: UploadConfig
    logger: BylineLogger
  }) => Promise<UploadVariantResult[]>
}

export interface DocumentUploadContext {
  db: IDbAdapter
  definition: CollectionDefinition
  collectionId: string
  /**
   * Current schema version for this collection. Forwarded into the
   * lifecycle context so the `documentVersions` row created by the upload
   * flow is stamped consistently with direct writes.
   */
  collectionVersion: number
  collectionPath: string
  storage: IStorageProvider
  logger: BylineLogger
  imageProcessor?: UploadImageProcessor
  /** Default content locale, forwarded to the lifecycle context. */
  defaultLocale: string
  /** Optional installation slugifier, forwarded to the lifecycle context. */
  slugifier?: SlugifierFn
}

export interface UploadDocumentParams {
  buffer: Buffer
  originalFilename: string
  mimeType: string
  fileSize: number
  fields?: Record<string, string>
  shouldCreateDocument?: boolean
  locale?: string
}

export interface UploadDocumentResult {
  documentId?: string
  documentVersionId?: string
  storedFile: StoredFileValue
  variants: Array<{ name: string; url: string }>
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

async function resolveUploadFilename(
  definition: CollectionDefinition,
  hookCtx: BeforeUploadContext,
  defaultFilename: string
): Promise<string> {
  const beforeUploadHook = definition.hooks?.beforeUpload
  if (!beforeUploadHook) {
    return defaultFilename
  }

  const fns = Array.isArray(beforeUploadHook) ? beforeUploadHook : [beforeUploadHook]
  let effectiveFilename = defaultFilename

  for (const fn of fns) {
    const override = await fn(hookCtx)
    if (typeof override === 'string' && override.trim()) {
      effectiveFilename = override.trim()
    }
  }

  return effectiveFilename
}

function buildDocumentData(
  definition: CollectionDefinition,
  storedFile: StoredFileValue,
  fields: Record<string, string>,
  fallbackTitle: string
): Record<string, unknown> {
  const documentData: Record<string, unknown> = {}

  for (const field of definition.fields) {
    if (field.type === 'image' || field.type === 'file') {
      documentData[field.name] = storedFile
      continue
    }

    const rawValue = fields[field.name]?.trim() ?? ''
    if (field.name === 'title') {
      documentData.title = rawValue || fallbackTitle
    } else if (rawValue !== '') {
      documentData[field.name] = rawValue
    }
  }

  return documentData
}

export async function uploadDocument(
  ctx: DocumentUploadContext,
  params: UploadDocumentParams
): Promise<UploadDocumentResult> {
  return withLogContext(
    { domain: 'services', module: 'upload', function: 'uploadDocument' },
    async () => {
      const { definition, collectionPath, storage, db, collectionId, logger, imageProcessor } = ctx
      const upload = definition.upload

      if (!upload) {
        throw ERR_VALIDATION(
          {
            message:
              `Collection '${collectionPath}' is not upload-enabled. ` +
              "Add an 'upload' block to its CollectionDefinition.",
            details: { collectionPath },
          },
          uploadDocument
        ).log(logger)
      }

      const {
        buffer,
        originalFilename,
        mimeType,
        fileSize,
        fields = {},
        shouldCreateDocument = true,
        locale,
      } = params

      const filename = sanitiseFilename(originalFilename || 'upload')
      const effectiveFilename = await resolveUploadFilename(
        definition,
        { filename, mimeType, fileSize, collectionPath },
        filename
      )

      if (upload.mimeTypes && upload.mimeTypes.length > 0) {
        if (!isMimeTypeAllowed(mimeType, upload.mimeTypes)) {
          throw ERR_VALIDATION(
            {
              message:
                `MIME type '${mimeType}' is not allowed for this collection. ` +
                `Allowed: ${upload.mimeTypes.join(', ')}.`,
              details: { collectionPath, mimeType },
            },
            uploadDocument
          ).log(logger)
        }
      }

      if (upload.maxFileSize && fileSize > upload.maxFileSize) {
        throw ERR_VALIDATION(
          {
            message:
              `File size ${fileSize} bytes exceeds the maximum allowed size of ` +
              `${upload.maxFileSize} bytes.`,
            details: { collectionPath, fileSize, maxFileSize: upload.maxFileSize },
          },
          uploadDocument
        ).log(logger)
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
        throw ERR_STORAGE(
          {
            message: 'File upload failed. See server logs for details.',
            details: { collectionPath },
            cause: err,
          },
          uploadDocument
        ).log(logger)
      }

      const imageMeta = imageProcessor
        ? await imageProcessor.extractMeta(buffer, mimeType)
        : { width: null, height: null, format: null }

      let variants: Array<{ name: string; url: string }> = []
      let variantStoragePaths: string[] = []
      const isProcessableImage =
        mimeType.startsWith('image/') && !(imageProcessor?.isBypassMimeType?.(mimeType) ?? false)

      if (
        isProcessableImage &&
        upload.sizes &&
        upload.sizes.length > 0 &&
        imageProcessor?.generateVariants
      ) {
        try {
          const generatedVariants = await imageProcessor.generateVariants({
            buffer,
            mimeType,
            storedFile,
            storage,
            upload,
            logger,
          })

          variants = generatedVariants.map((variant) => ({
            name: variant.name,
            url: storage.getUrl(variant.storagePath),
          }))
          variantStoragePaths = generatedVariants.map((variant) => variant.storagePath)
        } catch (err: unknown) {
          logger.error({ err, collectionPath }, 'image variant generation failed')
        }
      }

      for (const fn of normalizeCollectionHook(definition.hooks?.afterUpload)) {
        await fn({
          storedFilePath: storedFile.storage_path,
          variantPaths: variantStoragePaths,
          collectionPath,
        })
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

      const lifecycleCtx: DocumentLifecycleContext = {
        db,
        definition,
        collectionId,
        collectionVersion: ctx.collectionVersion,
        collectionPath,
        storage,
        logger,
        defaultLocale: ctx.defaultLocale,
        slugifier: ctx.slugifier,
      }

      try {
        const result = await createDocument(lifecycleCtx, {
          data: buildDocumentData(definition, storedFileValue, fields, effectiveFilename),
          locale: locale ?? ctx.defaultLocale,
        })

        return {
          documentId: result.documentId,
          documentVersionId: result.documentVersionId,
          storedFile: storedFileValue,
          variants,
        }
      } catch (err: unknown) {
        logger.error(
          { err, collectionPath },
          'document creation failed — rolling back storage files'
        )

        const rollbackPaths = [storedFile.storage_path, ...variantStoragePaths]
        for (const storagePath of rollbackPaths) {
          try {
            await storage.delete(storagePath)
          } catch (cleanupErr: unknown) {
            logger.error({ err: cleanupErr, storagePath }, 'rollback: failed to delete file')
          }
        }

        throw ERR_DATABASE(
          {
            message: 'File was stored but document creation failed. See server logs.',
            details: { collectionPath },
            cause: err,
          },
          uploadDocument
        ).log(logger)
      }
    }
  )
}
