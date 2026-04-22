/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

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
    { name: 'image', label: 'Image', type: 'image' },
    { name: 'title', label: 'Title', type: 'text' },
    { name: 'caption', label: 'Caption', type: 'textArea', optional: true },
  ],
  upload: {
    mimeTypes: ['image/png'],
    maxFileSize: 1024 * 1024,
    sizes: [{ name: 'thumbnail', width: 400, height: 400, fit: 'cover' }],
  },
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
    storage_provider: 'local',
    storage_path: 'media/original.png',
    storage_url: '/uploads/media/original.png',
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
    generateVariants: vi
      .fn()
      .mockResolvedValue([{ name: 'thumbnail', storagePath: 'media/thumbnail.webp' }]),
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
    collectionPath: uploadCollection.path,
    storage,
    logger: noopLogger,
    imageProcessor,
    defaultLocale: 'en',
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
    expect(result.variants).toEqual([{ name: 'thumbnail', url: '/uploads/media/thumbnail.webp' }])
  })

  it('applies beforeUpload filename override and creates a document', async () => {
    const beforeUpload = vi.fn().mockResolvedValue('overridden.png')
    const afterUpload = vi.fn().mockResolvedValue(undefined)
    const definition: CollectionDefinition = {
      ...uploadCollection,
      hooks: {
        beforeUpload,
        afterUpload,
      },
    }

    const { ctx, createDocumentVersion } = buildCtx({ definition })

    const result = await uploadDocument(ctx, {
      buffer: Buffer.from('png'),
      originalFilename: 'Hero Banner.PNG',
      mimeType: 'image/png',
      fileSize: 3,
      fields: { caption: 'Front page image' },
      shouldCreateDocument: true,
      locale: 'en',
    })

    expect(beforeUpload).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'hero-banner.png', collectionPath: 'media' })
    )
    expect(afterUpload).toHaveBeenCalledWith(
      expect.objectContaining({ collectionPath: 'media', storedFilePath: 'media/original.png' })
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

  it('rejects MIME types not allowed by the collection upload config', async () => {
    const { ctx } = buildCtx()

    await expect(
      uploadDocument(ctx, {
        buffer: Buffer.from('gif'),
        originalFilename: 'hero.gif',
        mimeType: 'image/gif',
        fileSize: 3,
      })
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION })
  })

  it('rolls back stored files when document creation fails', async () => {
    const { db } = createMockDb()
    db.commands.documents.createDocumentVersion = vi.fn().mockRejectedValue(new Error('db down'))
    const { storage, del } = createMockStorage()
    const ctx: DocumentUploadContext = {
      db,
      definition: uploadCollection,
      collectionId: 'col-1',
      collectionPath: uploadCollection.path,
      storage,
      logger: noopLogger,
      imageProcessor: createImageProcessor({
        generateVariants: vi.fn().mockResolvedValue([
          { name: 'thumbnail', storagePath: 'media/thumbnail.webp' },
          { name: 'card', storagePath: 'media/card.webp' },
        ]),
      }),
      defaultLocale: 'en',
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
