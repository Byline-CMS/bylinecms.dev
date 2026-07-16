/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type CollectionFieldDataAllLocales, defineCollection } from '@byline/core'
import { v7 as uuidv7 } from 'uuid'
import { describe, expect, it } from 'vitest'

import { flattenFieldSetData } from '../storage-flatten.js'
import { restoreFieldSetData } from '../storage-restore.js'
import { resolveStoreTypes } from '../storage-utils.js'

const DocsCollectionConfig = defineCollection({
  path: 'docs',
  labels: {
    singular: 'Document',
    plural: 'Documents',
  },
  fields: [
    { name: 'title', type: 'text', localized: true },
    { name: 'summary', type: 'text', localized: true },
    {
      name: 'publishedOn',
      type: 'datetime',
      mode: 'datetime',
      optional: true,
    },
    {
      name: 'featured',
      label: 'Featured',
      type: 'checkbox',
      optional: true,
      helpText: 'Is this page featured on the home page?',
    },
    { name: 'views', type: 'integer', optional: true },
    { name: 'price', label: 'Price', type: 'decimal', optional: true },
    { name: 'snippet', type: 'code', language: 'typescript', optional: true },

    {
      name: 'content',
      type: 'blocks',
      blocks: [
        {
          blockType: 'richTextBlock',
          fields: [
            { name: 'constrainedWidth', type: 'boolean', optional: true },
            { name: 'richText', type: 'richText', localized: true },
          ],
        },
        {
          blockType: 'photoBlock',
          fields: [
            { name: 'display', type: 'text', optional: true },
            { name: 'photo', type: 'image' },
            { name: 'alt', type: 'text', localized: false },
            { name: 'caption', type: 'richText', optional: true, localized: true },
          ],
        },
      ],
    },
    {
      name: 'reviews',
      type: 'array',
      fields: [
        {
          name: 'reviewItem',
          type: 'group',
          fields: [
            { name: 'rating', type: 'integer' },
            { name: 'comment', type: 'richText', localized: false },
          ],
        },
      ],
    },
    {
      name: 'links',
      type: 'array',
      fields: [{ name: 'link', type: 'text' }],
    },
  ],
})

type DocsFields = CollectionFieldDataAllLocales<typeof DocsCollectionConfig>

const fileId = uuidv7()

// Test document using the flat blocks shape: { _type, ...fields }
// This is the shape used by the application layer (forms, patches, API).
const sampleDocument: DocsFields = {
  title: {
    en: 'My First Document',
    es: 'Mi Primer Documento',
    fr: 'Mon Premier Document',
  },
  summary: {
    en: 'This is a sample document for testing purposes.',
    es: 'Este es un documento de muestra para fines de prueba.',
    fr: "Il s'agit d'un document d'exemple à des fins de test.",
  },
  publishedOn: new Date('2024-01-15T10:00:00Z'),
  featured: true,
  views: 100,
  price: '19.99',
  snippet: 'const answer: number = 42\nexport { answer }',
  content: [
    {
      _id: 'block1',
      _type: 'richTextBlock',
      constrainedWidth: true,
      richText: {
        en: { root: { paragraph: 'Some text here...' } },
        es: { root: { paragraph: 'Some spanish text here' } },
      },
    },
    {
      _id: 'block2',
      _type: 'photoBlock',
      display: 'wide',
      photo: {
        fileHash: undefined,
        fileId: fileId,
        filename: 'docs-photo-01.jpg',
        imageFormat: undefined,
        imageHeight: undefined,
        imageWidth: undefined,
        originalFilename: 'some-original-filename.jpg',
        mimeType: 'image/jpeg',
        fileSize: 123456,
        storageProvider: 'local',
        storagePath: 'uploads/docs-photo-01.jpg',
        processingStatus: 'pending',
        storageUrl: undefined,
        thumbnailGenerated: undefined,
      },
      alt: 'Some alt text here',
      caption: {
        en: { root: { paragraph: 'Some text here...' } },
        es: { root: { paragraph: 'Some spanish text here...' } },
      },
    },
  ],
  reviews: [
    {
      _id: 'review1',
      reviewItem: { rating: 6, comment: { root: { paragraph: 'Some review text here...' } } },
    },
    {
      _id: 'review2',
      reviewItem: {
        rating: 2,
        comment: { root: { paragraph: 'Some more reviews here...' } },
      },
    },
  ],
  links: [
    { _id: 'link1', link: 'https://example.com' },
    { _id: 'link2', link: 'https://another-example.com' },
  ],
}

// restoreFieldSetData produces the flat block shape directly: { _id, _type, ...fields }
// This matches the application layer shape — no separate attachMetaToDocument step needed.
const expectedRestored = {
  title: {
    en: 'My First Document',
    es: 'Mi Primer Documento',
    fr: 'Mon Premier Document',
  },
  summary: {
    en: 'This is a sample document for testing purposes.',
    es: 'Este es un documento de muestra para fines de prueba.',
    fr: "Il s'agit d'un document d'exemple à des fins de test.",
  },
  publishedOn: '2024-01-15T10:00:00.000Z',
  featured: true,
  views: 100,
  price: '19.99',
  snippet: 'const answer: number = 42\nexport { answer }',
  content: [
    {
      _id: 'block1',
      _type: 'richTextBlock',
      constrainedWidth: true,
      richText: {
        en: { root: { paragraph: 'Some text here...' } },
        es: { root: { paragraph: 'Some spanish text here' } },
      },
    },
    {
      _id: 'block2',
      _type: 'photoBlock',
      display: 'wide',
      photo: {
        fileHash: undefined,
        fileId: fileId,
        filename: 'docs-photo-01.jpg',
        imageFormat: undefined,
        imageHeight: undefined,
        imageWidth: undefined,
        originalFilename: 'some-original-filename.jpg',
        mimeType: 'image/jpeg',
        fileSize: 123456,
        storageProvider: 'local',
        storagePath: 'uploads/docs-photo-01.jpg',
        processingStatus: 'pending',
        storageUrl: undefined,
        thumbnailGenerated: undefined,
      },
      alt: 'Some alt text here',
      caption: {
        en: { root: { paragraph: 'Some text here...' } },
        es: { root: { paragraph: 'Some spanish text here...' } },
      },
    },
  ],
  reviews: [
    {
      _id: 'review1',
      reviewItem: { rating: 6, comment: { root: { paragraph: 'Some review text here...' } } },
    },
    {
      _id: 'review2',
      reviewItem: {
        rating: 2,
        comment: { root: { paragraph: 'Some more reviews here...' } },
      },
    },
  ],
  links: [
    { _id: 'link1', link: 'https://example.com' },
    { _id: 'link2', link: 'https://another-example.com' },
  ],
}

describe('01 Document Flattening and Reconstruction', () => {
  it('should flatten and reconstruct a document via schema-aware round-trip', () => {
    const flattened = flattenFieldSetData(DocsCollectionConfig.fields, sampleDocument as any, 'all')
    expect(flattened, 'Flattened document should not be null or undefined').toBeTruthy()
    expect(flattened.length > 0, 'Flattened document should contain field values').toBe(true)

    const { data: restored, warnings } = restoreFieldSetData(DocsCollectionConfig.fields, flattened)
    expect(restored, 'Restored document should not be null or undefined').toBeTruthy()
    expect(warnings, 'Round-trip restore should produce no warnings').toEqual([])

    const restoredJson = JSON.stringify(restored, null, 2)
    const expectedJson = JSON.stringify(expectedRestored, null, 2)

    expect(
      JSON.parse(restoredJson),
      'Restored document should match the expected flat block shape'
    ).toEqual(JSON.parse(expectedJson))
  })

  it('should resolve localized fields when a specific locale is requested', () => {
    const flattened = flattenFieldSetData(DocsCollectionConfig.fields, sampleDocument as any, 'all')

    const { data: restored } = restoreFieldSetData(DocsCollectionConfig.fields, flattened, 'en')
    expect(restored.title).toBe('My First Document')
    expect(restored.summary).toBe('This is a sample document for testing purposes.')
  })
})

describe('resolveStoreTypes', () => {
  it('should resolve text fields to text store', () => {
    const stores = resolveStoreTypes(DocsCollectionConfig.fields, ['path', 'title', 'summary'])
    expect([...stores].sort()).toEqual(['text'])
  })

  it('should resolve mixed field types to their respective stores', () => {
    const stores = resolveStoreTypes(DocsCollectionConfig.fields, [
      'title',
      'publishedOn',
      'featured',
      'views',
      'price',
    ])
    expect([...stores].sort()).toEqual(['boolean', 'datetime', 'numeric', 'text'])
  })

  it('should resolve blocks field to all child store types', () => {
    const stores = resolveStoreTypes(DocsCollectionConfig.fields, ['content'])
    // content blocks contain: richText (json), boolean, text, image (file)
    expect(stores.has('json'), 'should include json for richText').toBeTruthy()
    expect(stores.has('boolean'), 'should include boolean for constrainedWidth').toBeTruthy()
    expect(stores.has('text'), 'should include text for display/alt').toBeTruthy()
    expect(stores.has('file'), 'should include file for photo/image').toBeTruthy()
  })

  it('should resolve array field to child store types', () => {
    const stores = resolveStoreTypes(DocsCollectionConfig.fields, ['reviews'])
    // reviews array contains group with: integer (numeric), richText (json)
    expect(stores.has('numeric'), 'should include numeric for rating').toBeTruthy()
    expect(stores.has('json'), 'should include json for comment richText').toBeTruthy()
  })

  it('should ignore field names that do not exist in the collection', () => {
    const stores = resolveStoreTypes(DocsCollectionConfig.fields, [
      'status',
      'updated_at',
      'nonexistent',
    ])
    expect(stores.size, 'metadata fields should not resolve to any store').toBe(0)
  })

  it('should return empty set for empty field list', () => {
    const stores = resolveStoreTypes(DocsCollectionConfig.fields, [])
    expect(stores.size).toBe(0)
  })
})

describe('reserved field-name tolerance on restore', () => {
  // Installations that declared `path` as a user field before the
  // promotion to a system attribute may have left orphan rows in
  // `store_text` with `field_name = 'path'`. Those rows are not
  // referenced by any current collection schema, but they are still
  // read back by the UNION ALL. `restoreFieldSetData` must silently
  // skip them — the alternative would be a hard
  // "Field path not found" reconstruction failure that lights up
  // every read.
  it('silently skips orphan rows whose field_name is a reserved system attribute', () => {
    const orphanPathRow = {
      locale: 'all',
      field_path: ['path'],
      field_type: 'text',
      value: 'leftover-from-legacy-schema',
    } as const

    // A normal row alongside the orphan so we can prove reconstruction
    // succeeded rather than returning early.
    const titleRow = {
      locale: 'en',
      field_path: ['title'],
      field_type: 'text',
      value: 'Hello',
    } as const

    const { data: restored, warnings } = restoreFieldSetData(
      DocsCollectionConfig.fields,
      [orphanPathRow, titleRow] as any,
      'en'
    )

    expect(restored.path, 'reserved-name row must not land on the reconstructed document').toBe(
      undefined
    )
    expect(restored.title, 'non-reserved rows must still be restored').toBe('Hello')
    expect(warnings, 'reserved-name orphan must not surface as a restore warning').toEqual([])
  })

  it('does not raise warnings when the only row present is a reserved-name orphan', () => {
    const orphanPathRow = {
      locale: 'all',
      field_path: ['path'],
      field_type: 'text',
      value: 'whatever',
    } as const

    const { warnings } = restoreFieldSetData(DocsCollectionConfig.fields, [orphanPathRow] as any)
    expect(warnings, 'a reserved-name orphan must not be treated as an unknown field').toEqual([])
  })
})

describe('virtual fields', () => {
  // Mirrors the publications shape that motivated `virtual`: a per-item
  // "generate thumbnail" checkbox + page number inside an array group,
  // plus a top-level virtual scalar. Virtual values must flow through the
  // write pipeline (hooks see them) but emit NO store rows — reads
  // reconstruct them as absent, so the next editing session starts clean.
  const VirtualCollectionConfig = defineCollection({
    path: 'virtual-docs',
    labels: { singular: 'Virtual Doc', plural: 'Virtual Docs' },
    fields: [
      { name: 'title', type: 'text' },
      { name: 'regenerateAll', type: 'checkbox', virtual: true, optional: true },
      {
        name: 'files',
        type: 'array',
        fields: [
          {
            name: 'filesGroup',
            type: 'group',
            fields: [
              { name: 'label', type: 'text' },
              { name: 'generateThumbnail', type: 'checkbox', virtual: true, optional: true },
              { name: 'thumbnailPage', type: 'integer', virtual: true, defaultValue: 1 },
            ],
          },
        ],
      },
      {
        name: 'scratch',
        type: 'group',
        virtual: true,
        optional: true,
        fields: [{ name: 'note', type: 'text', optional: true }],
      },
    ],
  })

  const virtualDocument = {
    title: 'Publication-ish',
    regenerateAll: true,
    files: [
      {
        _id: 'item-1',
        filesGroup: { label: 'English PDF', generateThumbnail: true, thumbnailPage: 3 },
      },
      {
        _id: 'item-2',
        filesGroup: { label: 'Thai PDF', generateThumbnail: false, thumbnailPage: 1 },
      },
    ],
    scratch: { note: 'never stored' },
  }

  it('emits no store rows for virtual fields at any nesting depth', () => {
    const flattened = flattenFieldSetData(
      VirtualCollectionConfig.fields,
      virtualDocument as any,
      'all'
    )

    const paths = flattened.map((row) => row.field_path.join('.'))
    // Persisted values survive…
    expect(paths).toContain('title')
    expect(paths).toContain('files.0.filesGroup.label')
    expect(paths).toContain('files.1.filesGroup.label')
    // …virtual leaves do not (top-level, nested in array group)…
    expect(paths.some((p) => p.includes('regenerateAll'))).toBe(false)
    expect(paths.some((p) => p.includes('generateThumbnail'))).toBe(false)
    expect(paths.some((p) => p.includes('thumbnailPage'))).toBe(false)
    // …and a virtual structure field omits its whole subtree.
    expect(paths.some((p) => p.startsWith('scratch'))).toBe(false)
  })

  it('round-trip reconstruction leaves virtual fields structurally absent', () => {
    const flattened = flattenFieldSetData(
      VirtualCollectionConfig.fields,
      virtualDocument as any,
      'all'
    )
    const { data: restored, warnings } = restoreFieldSetData(
      VirtualCollectionConfig.fields,
      flattened
    )

    expect(warnings).toEqual([])
    expect(restored.title).toBe('Publication-ish')
    expect(restored.regenerateAll).toBeUndefined()
    expect(restored.scratch).toBeUndefined()

    const items = restored.files as Array<{ filesGroup: Record<string, unknown> }>
    expect(items).toHaveLength(2)
    expect(items[0]?.filesGroup.label).toBe('English PDF')
    expect(items[0]?.filesGroup.generateThumbnail).toBeUndefined()
    expect(items[0]?.filesGroup.thumbnailPage).toBeUndefined()
  })
})
