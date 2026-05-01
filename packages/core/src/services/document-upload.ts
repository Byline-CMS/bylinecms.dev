/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { RequestContext } from '@byline/auth'

import { assertActorCanPerform } from '../auth/assert-actor-can-perform.js'
import { ERR_DATABASE, ERR_STORAGE, ERR_VALIDATION } from '../lib/errors.js'
import { withLogContext } from '../lib/logger.js'
import { createDocument, type DocumentLifecycleContext } from './document-lifecycle.js'
import type {
  AfterStoreContext,
  AfterStoreHookFn,
  BeforeStoreContext,
  BeforeStoreHookFn,
  CollectionDefinition,
  Field,
  FileField,
  IDbAdapter,
  ImageField,
  IStorageProvider,
  PersistedVariant,
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

/**
 * One generated image variant returned by the image processor adapter.
 *
 * The processor knows the resolved dimensions / output format from the
 * Sharp pipeline, so the upload service persists them onto
 * `StoredFileValue.variants` without a re-read. `storageUrl` is captured
 * via `storage.getUrl(storagePath)` if the processor doesn't supply it
 * directly.
 */
export interface UploadVariantResult {
  name: string
  storagePath: string
  storageUrl?: string
  width?: number
  height?: number
  format?: string
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
  /**
   * Name of the upload-capable image/file field on this collection. The
   * service resolves the field, validates that it carries an `upload`
   * block, and reads MIME / size / sizes / storage / hooks from there.
   */
  fieldName: string
  storage: IStorageProvider
  logger: BylineLogger
  imageProcessor?: UploadImageProcessor
  /** Default content locale, forwarded to the lifecycle context. */
  defaultLocale: string
  /** Optional installation slugifier, forwarded to the lifecycle context. */
  slugifier?: SlugifierFn
  /**
   * Request-scoped auth context. Forwarded to the internal
   * `DocumentLifecycleContext` when an upload creates a document, and
   * consulted directly at the upload entry for the `create` ability
   * check. Required at the field-level upload boundary so `beforeStore` /
   * `afterStore` hooks can branch on `actor`.
   */
  requestContext?: RequestContext
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
  /**
   * The persisted file value, including the `variants` array with
   * `storagePath`, `storageUrl`, `width`, `height`, and `format` for each
   * generated derivative. Single source of truth — the legacy top-level
   * `variants` list is gone.
   */
  storedFile: StoredFileValue
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

/**
 * Walk a field set (recursing into `group` / `array` / `blocks`) and
 * locate the `image | file` field with the given name. Returns the
 * field reference, or `undefined` if no match is found.
 *
 * Block/array/group nesting matters because a future schema may define
 * upload-capable fields inside repeating structures. Today's schemas
 * declare uploads at the top level, but the resolver doesn't assume
 * that.
 */
function findUploadField(
  fields: readonly Field[],
  fieldName: string
): ImageField | FileField | undefined {
  for (const field of fields) {
    if ((field.type === 'image' || field.type === 'file') && field.name === fieldName) {
      return field
    }
    if (field.type === 'group' || field.type === 'array') {
      const nested = findUploadField(field.fields, fieldName)
      if (nested) return nested
    }
    if (field.type === 'blocks') {
      for (const block of field.blocks) {
        const nested = findUploadField(block.fields, fieldName)
        if (nested) return nested
      }
    }
  }
  return undefined
}

function normalizeUploadHook<T>(hook: T | T[] | undefined): T[] {
  if (!hook) return []
  return Array.isArray(hook) ? hook : [hook]
}

/**
 * Run the `beforeStore` chain. Each function receives the previous
 * function's filename override (fold). A function may:
 *
 *   - return a string or `{ filename }` to substitute a new filename;
 *   - return `{ error }` to short-circuit with `ERR_VALIDATION`;
 *   - return `void` / `undefined` to leave the filename unchanged.
 *
 * Returns the resolved filename.
 */
async function runBeforeStoreChain(
  hooks: BeforeStoreHookFn[],
  ctx: BeforeStoreContext,
  logger: BylineLogger
): Promise<string> {
  let effective = ctx.filename
  for (const fn of hooks) {
    const result = await fn({ ...ctx, filename: effective })
    if (result == null) continue
    if (typeof result === 'string') {
      const trimmed = result.trim()
      if (trimmed) effective = trimmed
      continue
    }
    if (typeof result === 'object') {
      if ('error' in result && typeof result.error === 'string' && result.error) {
        throw ERR_VALIDATION(
          {
            message: result.error,
            details: { collectionPath: ctx.collectionPath, fieldName: ctx.fieldName },
          },
          runBeforeStoreChain
        ).log(logger)
      }
      if ('filename' in result && typeof result.filename === 'string') {
        const trimmed = result.filename.trim()
        if (trimmed) effective = trimmed
      }
    }
  }
  return effective
}

export async function uploadDocument(
  ctx: DocumentUploadContext,
  params: UploadDocumentParams
): Promise<UploadDocumentResult> {
  return withLogContext(
    { domain: 'services', module: 'upload', function: 'uploadDocument' },
    async () => {
      const {
        definition,
        collectionPath,
        storage,
        db,
        collectionId,
        logger,
        imageProcessor,
        fieldName,
      } = ctx
      // Upload is effectively a write under collection scope — enforce
      // the `create` ability even when `shouldCreateDocument: false` so
      // anonymous callers cannot push bytes into storage.
      assertActorCanPerform(ctx.requestContext, collectionPath, 'create')

      const field = findUploadField(definition.fields, fieldName)
      if (!field) {
        throw ERR_VALIDATION(
          {
            message:
              `Field '${fieldName}' on collection '${collectionPath}' is not an ` +
              'upload-capable image/file field, or does not exist.',
            details: { collectionPath, fieldName },
          },
          uploadDocument
        ).log(logger)
      }
      const upload = field.upload
      if (!upload) {
        throw ERR_VALIDATION(
          {
            message:
              `Field '${fieldName}' on collection '${collectionPath}' has no 'upload' ` +
              'block. Add an UploadConfig to the field definition.',
            details: { collectionPath, fieldName },
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

      // -- Validation runs FIRST. Hooks never see a file that's about to
      //    be rejected.
      if (upload.mimeTypes && upload.mimeTypes.length > 0) {
        if (!isMimeTypeAllowed(mimeType, upload.mimeTypes)) {
          throw ERR_VALIDATION(
            {
              message:
                `MIME type '${mimeType}' is not allowed for field '${fieldName}'. ` +
                `Allowed: ${upload.mimeTypes.join(', ')}.`,
              details: { collectionPath, fieldName, mimeType },
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
              `${upload.maxFileSize} bytes for field '${fieldName}'.`,
            details: {
              collectionPath,
              fieldName,
              fileSize,
              maxFileSize: upload.maxFileSize,
            },
          },
          uploadDocument
        ).log(logger)
      }

      // -- beforeStore chain. May rename, may reject. Hooks need a
      //    `RequestContext` for `actor.id` / tenant prefixing; if none
      //    was supplied at the upload entry we hand them an empty one
      //    rather than throw — `assertActorCanPerform` is the auth gate
      //    for whether the upload should run at all, not the hook layer.
      const sanitised = sanitiseFilename(originalFilename || 'upload')
      const beforeStoreHooks = normalizeUploadHook<BeforeStoreHookFn>(upload.hooks?.beforeStore)
      const effectiveFilename = await runBeforeStoreChain(
        beforeStoreHooks,
        {
          fieldName,
          field,
          filename: sanitised,
          mimeType,
          fileSize,
          fields,
          collectionPath,
          requestContext: ctx.requestContext ?? {
            actor: null,
            requestId: '',
            readMode: 'any',
          },
        },
        logger
      )

      // -- Storage write. Filename is the post-hook value, so generated
      //    variants automatically inherit the new prefix.
      let storedFile: StoredFileLocation
      try {
        storedFile = await storage.upload(buffer, {
          filename: effectiveFilename,
          mimeType,
          size: fileSize,
          collection: collectionPath,
        })
      } catch (err: unknown) {
        throw ERR_STORAGE(
          {
            message: 'File upload failed. See server logs for details.',
            details: { collectionPath, fieldName },
            cause: err,
          },
          uploadDocument
        ).log(logger)
      }

      const imageMeta = imageProcessor
        ? await imageProcessor.extractMeta(buffer, mimeType)
        : { width: null, height: null, format: null }

      let persistedVariants: PersistedVariant[] = []
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
          const generated = await imageProcessor.generateVariants({
            buffer,
            mimeType,
            storedFile,
            storage,
            upload,
            logger,
          })
          persistedVariants = generated.map((variant) => ({
            name: variant.name,
            storagePath: variant.storagePath,
            storageUrl: variant.storageUrl ?? storage.getUrl(variant.storagePath),
            width: variant.width,
            height: variant.height,
            format: variant.format,
          }))
          variantStoragePaths = generated.map((v) => v.storagePath)
        } catch (err: unknown) {
          logger.error({ err, collectionPath, fieldName }, 'image variant generation failed')
        }
      }

      const storedFileValue: StoredFileValue = {
        fileId: crypto.randomUUID(),
        filename: effectiveFilename,
        originalFilename,
        mimeType,
        fileSize,
        storageProvider: storedFile.storageProvider,
        storagePath: storedFile.storagePath,
        storageUrl: storedFile.storageUrl ?? undefined,
        fileHash: undefined,
        imageWidth: imageMeta.width ?? undefined,
        imageHeight: imageMeta.height ?? undefined,
        imageFormat: imageMeta.format ?? undefined,
        processingStatus: 'complete',
        thumbnailGenerated: persistedVariants.some((variant) => variant.name === 'thumbnail'),
        variants: persistedVariants.length > 0 ? persistedVariants : undefined,
      }

      // -- afterStore chain. Failures are logged but do not roll back
      //    the storage write (consistent with `afterCreate` etc.).
      const afterStoreHooks = normalizeUploadHook<AfterStoreHookFn>(upload.hooks?.afterStore)
      for (const fn of afterStoreHooks) {
        try {
          const afterCtx: AfterStoreContext = {
            fieldName,
            field,
            storedFile: storedFileValue,
            fields,
            collectionPath,
            requestContext: ctx.requestContext ?? {
              actor: null,
              requestId: '',
              readMode: 'any',
            },
          }
          await fn(afterCtx)
        } catch (err: unknown) {
          logger.error({ err, collectionPath, fieldName }, 'afterStore hook failed')
        }
      }

      if (!shouldCreateDocument) {
        return { storedFile: storedFileValue }
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
        requestContext: ctx.requestContext,
      }

      try {
        const result = await createDocument(lifecycleCtx, {
          data: buildDocumentData(definition, fieldName, storedFileValue, fields, effectiveFilename),
          locale: locale ?? ctx.defaultLocale,
        })

        return {
          documentId: result.documentId,
          documentVersionId: result.documentVersionId,
          storedFile: storedFileValue,
        }
      } catch (err: unknown) {
        logger.error(
          { err, collectionPath, fieldName },
          'document creation failed — rolling back storage files'
        )

        const rollbackPaths = [storedFile.storagePath, ...variantStoragePaths]
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
            details: { collectionPath, fieldName },
            cause: err,
          },
          uploadDocument
        ).log(logger)
      }
    }
  )
}

function buildDocumentData(
  definition: CollectionDefinition,
  uploadFieldName: string,
  storedFile: StoredFileValue,
  fields: Record<string, string>,
  fallbackTitle: string
): Record<string, unknown> {
  const documentData: Record<string, unknown> = {}

  for (const field of definition.fields) {
    if (field.name === uploadFieldName && (field.type === 'image' || field.type === 'file')) {
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
