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

// Array items recurse into the child field schemas (the FAQBlock shape:
// multiple direct value fields per item, plus an optional group child that
// stays permissive — the same depth boundary top-level groups have).
const Faqs = defineCollection({
  path: 'faqs',
  labels: { singular: 'FAQ', plural: 'FAQs' },
  fields: [
    { name: 'title', type: 'text' },
    {
      name: 'faq',
      type: 'array',
      validation: { minLength: 1 },
      fields: [
        { name: 'question', type: 'text' },
        { name: 'answer', type: 'richText', optional: true },
        {
          name: 'meta',
          type: 'group',
          optional: true,
          fields: [{ name: 'anchor', type: 'text' }],
        },
      ],
    },
  ],
})

const faqItem = { question: 'What is Byline?', answer: { root: {} } }

describe('array item schemas', () => {
  const schemas = createCollectionSchemas(Faqs)

  it('accepts complete items, with or without the synthetic _id', () => {
    const result = schemas.fields.safeParse({
      title: 'FAQ page',
      faq: [faqItem, { ...faqItem, _id: '0198c0de-0000-7000-8000-000000000001' }],
    })
    expect(result.success).toBe(true)
  })

  it('rejects an item missing a required child field in the strict schema', () => {
    const result = schemas.fields.safeParse({
      title: 'FAQ page',
      faq: [{ answer: { root: {} } }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a wrongly typed child value in the strict schema', () => {
    const result = schemas.fields.safeParse({
      title: 'FAQ page',
      faq: [{ ...faqItem, question: 42 }],
    })
    expect(result.success).toBe(false)
  })

  it('enforces the array-level minLength bound', () => {
    const result = schemas.fields.safeParse({ title: 'FAQ page', faq: [] })
    expect(result.success).toBe(false)
  })

  it('leaves group children permissive inside items', () => {
    const result = schemas.fields.safeParse({
      title: 'FAQ page',
      faq: [{ ...faqItem, meta: { anything: true } }],
    })
    expect(result.success).toBe(true)
  })

  it('keeps reads lenient — items with missing children still parse in the get schema', () => {
    const parsed = schemas.get.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      status: 'draft',
      createdAt: '2026-07-15T12:00:00.000Z',
      updatedAt: '2026-07-15T12:00:00.000Z',
      // A schema-evolved document: item pre-dates the `question` field.
      fields: { title: 'FAQ page', faq: [{ _id: 'abc', answer: null }] },
    })
    expect(parsed.fields.faq).toHaveLength(1)
  })
})
