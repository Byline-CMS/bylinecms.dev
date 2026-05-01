/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createSuperAdminContext } from '@byline/auth'
import { describe, expect, it, vi } from 'vitest'

import { BylineError, ErrorCodes } from '../lib/errors.js'
import { uploadDocument } from './document-upload.js'
import type { CollectionDefinition, IDbAdapter, IStorageProvider } from '../@types/index.js'
import type { BylineLogger } from '../lib/logger.js'
import type { DocumentUploadContext, UploadImageProcessor } from './document-upload.js'

const uploadCollection: CollectionDefinition = {
  path: 'media',
  labels: { singular: 'Media', plural: 'Media' },
  fields: [
    {
      name: 'image',
      label: 'Image',
      type: 'image',
      upload: {
        mimeTypes: ['image/png'],
        maxFileSize: 1024 * 1024,
        sizes: [{ name: 'thumbnail', width: 400, height: 400, fit: 'cover' }],
      },
    },
    { name: 'title', label: 'Title', type: 'text' },
    { name: 'caption', label: 'Caption', type: 'textArea', optional: true },
  ],
}

function withFieldUpload(
  collection: CollectionDefinition,
  fieldName: string,
  patch: (field: any) => void
): CollectionDefinition {
  return {
    ...collection,
    fields: collection.fields.map((f) => {
      if (f.name !== fieldName) return f
      const next = structuredClone(f)
      patch(next)
      return next
    }),
  }
}

function createMockDb() {
  const createDocumentVersion = vi.fn().mockResolvedValue({
    document: { id: 'ver-1', document_id: 'doc-1' },
    fieldCount: 2,
  })

  const db: IDbAdapter = {
    commands: {
      collections: {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      documents: {
        createDocumentVersion,
        setDocumentStatus: vi.fn(),
        archivePublishedVersions: vi.fn(),
        softDeleteDocument: vi.fn(),
      },
    },
    queries: {
      collections: {
        getAllCollections: vi.fn(),
        getCollectionByPath: vi.fn(),
        getCollectionById: vi.fn(),
      },
      documents: {
        getDocumentById: vi.fn(),
        getCurrentVersionMetadata: vi.fn(),
        getDocumentByPath: vi.fn(),
        getDocumentByVersion: vi.fn(),
        getDocumentsByVersionIds: vi.fn(),
        getDocumentsByDocumentIds: vi.fn(),
        getDocumentHistory: vi.fn(),
        getPublishedVersion: vi.fn(),
        getPublishedDocumentIds: vi.fn(),
        getDocumentCountsByStatus: vi.fn(),
        findDocuments: vi.fn(),
      },
    },
  }

  return { db, createDocumentVersion }
}

function createMockStorage() {
  const upload = vi.fn().mockResolvedValue({
    storageProvider: 'local',
    storagePath: 'media/original.png',
    storageUrl: '/uploads/media/original.png',
  })
  const del = vi.fn().mockResolvedValue(undefined)
  const storage: IStorageProvider = {
    providerName: 'local',
    upload,
    delete: del,
    getUrl: vi.fn((storagePath: string) => `/uploads/${storagePath}`),
  }

  return { storage, upload, del }
}

const noopLogger: BylineLogger = {
  log: vi.fn(),
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
}

function createImageProcessor(overrides?: Partial<UploadImageProcessor>): UploadImageProcessor {
  return {
    extractMeta: vi.fn().mockResolvedValue({ width: 1200, height: 800, format: 'png' }),
    isBypassMimeType: vi.fn().mockReturnValue(false),
    generateVariants: vi.fn().mockResolvedValue([
      {
        name: 'thumbnail',
        storagePath: 'media/thumbnail.webp',
        width: 400,
        height: 400,
        format: 'webp',
      },
    ]),
    ...overrides,
  }
}

function buildCtx(overrides?: Partial<DocumentUploadContext>) {
  const { db, createDocumentVersion } = createMockDb()
  const { storage, upload, del } = createMockStorage()
  const imageProcessor = createImageProcessor()

  const ctx: DocumentUploadContext = {
    db,
    definition: uploadCollection,
    collectionId: 'col-1',
    collectionVersion: 1,
    collectionPath: uploadCollection.path,
    fieldName: 'image',
    storage,
    logger: noopLogger,
    imageProcessor,
    defaultLocale: 'en',
    requestContext: createSuperAdminContext({ id: 'test-super-admin' }),
    ...overrides,
  }

  return { ctx, createDocumentVersion, upload, del, imageProcessor }
}

describe('uploadDocument service', () => {
  it('uploads a file without creating a document when requested', async () => {
    const { ctx, createDocumentVersion, upload } = buildCtx()

    const result = await uploadDocument(ctx, {
      buffer: Buffer.from('png'),
      originalFilename: 'hero.png',
      mimeType: 'image/png',
      fileSize: 3,
      shouldCreateDocument: false,
    })

    expect(upload).toHaveBeenCalledOnce()
    expect(createDocumentVersion).not.toHaveBeenCalled()
    expect(result.documentId).toBeUndefined()
    expect(result.storedFile.filename).toBe('hero.png')
    // Variants are now persisted on the file value itself — single source of truth.
    expect(result.storedFile.variants).toEqual([
      {
        name: 'thumbnail',
        storagePath: 'media/thumbnail.webp',
        storageUrl: '/uploads/media/thumbnail.webp',
        width: 400,
        height: 400,
        format: 'webp',
      },
    ])
  })

  it('applies beforeStore filename override and threads it into storage.upload + variants', async () => {
    const beforeStore = vi.fn().mockResolvedValue('overridden.png')
    const afterStore = vi.fn().mockResolvedValue(undefined)
    const definition = withFieldUpload(uploadCollection, 'image', (f) => {
      f.upload.hooks = { beforeStore, afterStore }
    })

    const { ctx, createDocumentVersion, upload } = buildCtx({ definition })

    const result = await uploadDocument(ctx, {
      buffer: Buffer.from('png'),
      originalFilename: 'Hero Banner.PNG',
      mimeType: 'image/png',
      fileSize: 3,
      fields: { caption: 'Front page image' },
      shouldCreateDocument: true,
      locale: 'en',
    })

    // beforeStore receives the rich context.
    expect(beforeStore).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldName: 'image',
        filename: 'hero-banner.png',
        collectionPath: 'media',
        fields: { caption: 'Front page image' },
      })
    )
    // The override is threaded into storage.upload — fixes the legacy bug
    // where the rewritten filename only landed in StoredFileValue metadata.
    expect(upload).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ filename: 'overridden.png' })
    )
    // afterStore receives the persisted StoredFileValue with variants.
    expect(afterStore).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldName: 'image',
        storedFile: expect.objectContaining({
          filename: 'overridden.png',
          variants: expect.any(Array),
        }),
      })
    )
    expect(createDocumentVersion).toHaveBeenCalledOnce()
    expect(createDocumentVersion.mock.calls[0]?.[0].documentData).toEqual(
      expect.objectContaining({
        title: 'overridden.png',
        caption: 'Front page image',
        image: expect.objectContaining({ filename: 'overridden.png' }),
      })
    )
    expect(result.documentId).toBe('doc-1')
  })

  it('folds a chain of beforeStore hooks (each sees the previous rename)', async () => {
    const definition = withFieldUpload(uploadCollection, 'image', (f) => {
      f.upload.hooks = {
        beforeStore: [
          ({ filename }: any) => `tenant-${filename}`,
          ({ filename, fields }: any) =>
            fields.publicationId ? `${fields.publicationId}-${filename}` : undefined,
        ],
      }
    })

    const { ctx, upload } = buildCtx({ definition })

    await uploadDocument(ctx, {
      buffer: Buffer.from('png'),
      originalFilename: 'hero.png',
      mimeType: 'image/png',
      fileSize: 3,
      fields: { publicationId: 'PUB-42' },
      shouldCreateDocument: false,
    })

    expect(upload).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ filename: 'PUB-42-tenant-hero.png' })
    )
  })

  it('beforeStore { error } short-circuits — no storage write, no variants, no afterStore', async () => {
    const afterStore = vi.fn()
    const definition = withFieldUpload(uploadCollection, 'image', (f) => {
      f.upload.hooks = {
        beforeStore: () => ({ error: 'duplicate publication ID' }),
        afterStore,
      }
    })

    const { ctx, upload, imageProcessor } = buildCtx({ definition })

    await expect(
      uploadDocument(ctx, {
        buffer: Buffer.from('png'),
        originalFilename: 'hero.png',
        mimeType: 'image/png',
        fileSize: 3,
        shouldCreateDocument: false,
      })
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION })

    expect(upload).not.toHaveBeenCalled()
    expect(imageProcessor.generateVariants).not.toHaveBeenCalled()
    expect(afterStore).not.toHaveBeenCalled()
  })

  it('rejects MIME types not allowed by the field upload config — before any hook fires', async () => {
    const beforeStore = vi.fn()
    const definition = withFieldUpload(uploadCollection, 'image', (f) => {
      f.upload.hooks = { beforeStore }
    })

    const { ctx } = buildCtx({ definition })

    await expect(
      uploadDocument(ctx, {
        buffer: Buffer.from('gif'),
        originalFilename: 'hero.gif',
        mimeType: 'image/gif',
        fileSize: 3,
      })
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION })

    // Validation gate runs ahead of user code.
    expect(beforeStore).not.toHaveBeenCalled()
  })

  it('rejects when the named field is not upload-capable', async () => {
    const { ctx } = buildCtx({ fieldName: 'caption' })

    await expect(
      uploadDocument(ctx, {
        buffer: Buffer.from('png'),
        originalFilename: 'hero.png',
        mimeType: 'image/png',
        fileSize: 3,
      })
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION })
  })

  it('afterStore failures are logged but do not roll back the storage write', async () => {
    const afterStore = vi.fn().mockRejectedValue(new Error('boom'))
    const definition = withFieldUpload(uploadCollection, 'image', (f) => {
      f.upload.hooks = { afterStore }
    })

    const { ctx, upload, del } = buildCtx({ definition })

    const result = await uploadDocument(ctx, {
      buffer: Buffer.from('png'),
      originalFilename: 'hero.png',
      mimeType: 'image/png',
      fileSize: 3,
      shouldCreateDocument: false,
    })

    expect(upload).toHaveBeenCalledOnce()
    expect(afterStore).toHaveBeenCalledOnce()
    expect(del).not.toHaveBeenCalled()
    expect(result.storedFile.filename).toBe('hero.png')
  })

  it('rolls back stored files when document creation fails', async () => {
    const { db } = createMockDb()
    db.commands.documents.createDocumentVersion = vi.fn().mockRejectedValue(new Error('db down'))
    const { storage, del } = createMockStorage()
    const ctx: DocumentUploadContext = {
      db,
      definition: uploadCollection,
      collectionId: 'col-1',
      collectionVersion: 1,
      collectionPath: uploadCollection.path,
      fieldName: 'image',
      storage,
      logger: noopLogger,
      imageProcessor: createImageProcessor({
        generateVariants: vi.fn().mockResolvedValue([
          { name: 'thumbnail', storagePath: 'media/thumbnail.webp' },
          { name: 'card', storagePath: 'media/card.webp' },
        ]),
      }),
      defaultLocale: 'en',
      requestContext: createSuperAdminContext({ id: 'test-super-admin' }),
    }

    let error: unknown
    try {
      await uploadDocument(ctx, {
        buffer: Buffer.from('png'),
        originalFilename: 'hero.png',
        mimeType: 'image/png',
        fileSize: 3,
      })
    } catch (err) {
      error = err
    }

    expect(error).toBeInstanceOf(BylineError)
    expect((error as BylineError).code).toBe(ErrorCodes.DATABASE)
    expect(del).toHaveBeenCalledTimes(3)
    expect(del).toHaveBeenNthCalledWith(1, 'media/original.png')
    expect(del).toHaveBeenNthCalledWith(2, 'media/thumbnail.webp')
    expect(del).toHaveBeenNthCalledWith(3, 'media/card.webp')
  })
})
