/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  defineCollection,
  type IStorageProvider,
  type UploadFileOptions,
  uploadField,
} from '@byline/core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  type MultiCollectionTestContext,
  setupMultiCollectionTestClient,
} from '../fixtures/setup.js'

let ctx: MultiCollectionTestContext
const suffix = `${Date.now()}-nested-upload-${Math.floor(Math.random() * 1e6)}`
const collectionPath = `test-documents-${suffix}`
const beforeStore = vi.fn()
const upload = vi.fn(
  async (_stream: NodeJS.ReadableStream | Buffer, options: UploadFileOptions) => ({
    storageProvider: 'test',
    storagePath: `${collectionPath}/${options.filename}`,
    storageUrl: `/uploads/${collectionPath}/${options.filename}`,
  })
)
const storage: IStorageProvider = {
  providerName: 'test',
  upload,
  delete: vi.fn(async () => undefined),
  getUrl: (path) => `/uploads/${path}`,
}
const publicationFile = {
  name: 'publicationFile',
  type: 'file' as const,
  upload: { mimeTypes: ['application/pdf'] },
}
const definition = defineCollection({
  path: collectionPath,
  labels: { singular: 'Document', plural: 'Documents' },
  fields: [
    {
      name: 'files',
      type: 'array',
      fields: [{ name: 'filesGroup', type: 'group', fields: [publicationFile] }],
    },
  ],
})

beforeAll(async () => {
  ctx = await setupMultiCollectionTestClient([definition], {
    storage,
    hooks: {
      uploads: {
        [`${collectionPath}.files.filesGroup.publicationFile`]: { beforeStore },
      },
    },
  })
}, 30_000)

afterAll(async () => {
  await ctx.db.commands.collections.delete(ctx.collectionIds[collectionPath] as string)
})

describe('field upload server-hook registry', () => {
  it('fires for an indexed runtime instance of a nested upload field', async () => {
    const { id: collectionId, version: collectionVersion } =
      await ctx.client.resolveCollectionRecord(collectionPath)

    const result = await uploadField(
      {
        db: ctx.db,
        definition,
        collectionId,
        collectionVersion,
        collectionPath,
        fieldName: 'publicationFile',
        storage,
        logger: ctx.client.logger,
        defaultLocale: ctx.client.defaultLocale,
        requestContext: await ctx.client.resolveRequestContext(),
      },
      {
        buffer: Buffer.from('pdf'),
        originalFilename: 'publication.pdf',
        mimeType: 'application/pdf',
        fileSize: 3,
        fields: { runtimeFormPath: 'files[2].filesGroup.publicationFile' },
        shouldCreateDocument: false,
      }
    )

    expect(beforeStore).toHaveBeenCalledOnce()
    expect(beforeStore).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldName: 'publicationFile',
        field: publicationFile,
        fields: { runtimeFormPath: 'files[2].filesGroup.publicationFile' },
      })
    )
    expect(upload).toHaveBeenCalledOnce()
    expect(result.storedFile.filename).toBe('publication.pdf')
  })
})
