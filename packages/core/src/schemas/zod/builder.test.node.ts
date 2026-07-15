import { describe, expect, it } from 'vitest'

import { defineCollection } from '../../@types/collection-types.js'
import { createCollectionSchemas } from './builder.js'
import type { CollectionFieldData } from '../../@types/collection-types.js'

const Assets = defineCollection({
  path: 'assets',
  labels: { singular: 'Asset', plural: 'Assets' },
  fields: [
    { name: 'price', type: 'decimal' },
    { name: 'download', type: 'file' },
    { name: 'owner', type: 'relation', targetCollection: 'people' },
  ],
})

const fieldsFixture = {
  price: '1234567890.123456789',
  download: {
    fileId: 'file-1',
    filename: 'report.pdf',
    originalFilename: 'Report.pdf',
    mimeType: 'application/pdf',
    fileSize: 4096,
    storageProvider: 'local',
    storagePath: 'assets/report.pdf',
    processingStatus: 'complete' as const,
  },
  owner: {
    targetDocumentId: 'person-1',
    targetCollectionId: 'people',
  },
} satisfies CollectionFieldData<typeof Assets>

describe('collection Zod schemas', () => {
  it('parses the canonical decimal and file storage read shapes', () => {
    const parsed = createCollectionSchemas(Assets).get.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      status: 'published',
      createdAt: '2026-07-15T12:00:00.000Z',
      updatedAt: '2026-07-15T12:00:00.000Z',
      fields: fieldsFixture,
    })

    expect(parsed.fields.price).toBe(fieldsFixture.price)
    expect(parsed.fields.download?.fileSize).toBe(4096)
  })

  it('rejects null for a required single relation in the strict fields schema', () => {
    const result = createCollectionSchemas(Assets).fields.safeParse({
      ...fieldsFixture,
      owner: null,
    })

    expect(result.success).toBe(false)
  })
})
