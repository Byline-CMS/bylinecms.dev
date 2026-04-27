/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import assert from 'node:assert'
import { describe, it } from 'node:test'

import { type CollectionFieldDataAllLocales, defineCollection } from '@byline/core'
import { v7 as uuidv7 } from 'uuid'

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
    assert(flattened, 'Flattened document should not be null or undefined')
    assert(flattened.length > 0, 'Flattened document should contain field values')

    const restored = restoreFieldSetData(DocsCollectionConfig.fields, flattened)
    assert(restored, 'Restored document should not be null or undefined')

    const restoredJson = JSON.stringify(restored, null, 2)
    const expectedJson = JSON.stringify(expectedRestored, null, 2)

    assert.deepStrictEqual(
      JSON.parse(restoredJson),
      JSON.parse(expectedJson),
      'Restored document should match the expected flat block shape'
    )
  })

  it('should resolve localized fields when a specific locale is requested', () => {
    const flattened = flattenFieldSetData(DocsCollectionConfig.fields, sampleDocument as any, 'all')

    const restored = restoreFieldSetData(DocsCollectionConfig.fields, flattened, 'en')
    assert.strictEqual(restored.title, 'My First Document')
    assert.strictEqual(restored.summary, 'This is a sample document for testing purposes.')
  })
})

describe('resolveStoreTypes', () => {
  it('should resolve text fields to text store', () => {
    const stores = resolveStoreTypes(DocsCollectionConfig.fields, ['path', 'title', 'summary'])
    assert.deepStrictEqual([...stores].sort(), ['text'])
  })

  it('should resolve mixed field types to their respective stores', () => {
    const stores = resolveStoreTypes(DocsCollectionConfig.fields, [
      'title',
      'publishedOn',
      'featured',
      'views',
      'price',
    ])
    assert.deepStrictEqual([...stores].sort(), ['boolean', 'datetime', 'numeric', 'text'])
  })

  it('should resolve blocks field to all child store types', () => {
    const stores = resolveStoreTypes(DocsCollectionConfig.fields, ['content'])
    // content blocks contain: richText (json), boolean, text, image (file)
    assert.ok(stores.has('json'), 'should include json for richText')
    assert.ok(stores.has('boolean'), 'should include boolean for constrainedWidth')
    assert.ok(stores.has('text'), 'should include text for display/alt')
    assert.ok(stores.has('file'), 'should include file for photo/image')
  })

  it('should resolve array field to child store types', () => {
    const stores = resolveStoreTypes(DocsCollectionConfig.fields, ['reviews'])
    // reviews array contains group with: integer (numeric), richText (json)
    assert.ok(stores.has('numeric'), 'should include numeric for rating')
    assert.ok(stores.has('json'), 'should include json for comment richText')
  })

  it('should ignore field names that do not exist in the collection', () => {
    const stores = resolveStoreTypes(DocsCollectionConfig.fields, [
      'status',
      'updated_at',
      'nonexistent',
    ])
    assert.strictEqual(stores.size, 0, 'metadata fields should not resolve to any store')
  })

  it('should return empty set for empty field list', () => {
    const stores = resolveStoreTypes(DocsCollectionConfig.fields, [])
    assert.strictEqual(stores.size, 0)
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

    const restored = restoreFieldSetData(
      DocsCollectionConfig.fields,
      [orphanPathRow, titleRow] as any,
      'en'
    )

    assert.strictEqual(
      restored.path,
      undefined,
      'reserved-name row must not land on the reconstructed document'
    )
    assert.strictEqual(restored.title, 'Hello', 'non-reserved rows must still be restored')
  })

  it('does not throw when the only row present is a reserved-name orphan', () => {
    const orphanPathRow = {
      locale: 'all',
      field_path: ['path'],
      field_type: 'text',
      value: 'whatever',
    } as const

    assert.doesNotThrow(() => {
      restoreFieldSetData(DocsCollectionConfig.fields, [orphanPathRow] as any)
    }, 'a reserved-name orphan must not be treated as an unknown field')
  })
})
