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

import { flattenFieldSetData, resolveStoreTypes, restoreFieldSetData } from '../storage-utils.js'

const DocsCollectionConfig = defineCollection({
  path: 'docs',
  labels: {
    singular: 'Document',
    plural: 'Documents',
  },
  fields: [
    { name: 'path', type: 'text' /* unique: true */ },
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
  path: 'my-first-document',
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
        file_hash: undefined,
        file_id: fileId,
        filename: 'docs-photo-01.jpg',
        image_format: undefined,
        image_height: undefined,
        image_width: undefined,
        original_filename: 'some-original-filename.jpg',
        mime_type: 'image/jpeg',
        file_size: 123456,
        storage_provider: 'local',
        storage_path: 'uploads/docs-photo-01.jpg',
        processing_status: 'pending',
        storage_url: undefined,
        thumbnail_generated: undefined,
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
  path: 'my-first-document',
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
        file_hash: undefined,
        file_id: fileId,
        filename: 'docs-photo-01.jpg',
        image_format: undefined,
        image_height: undefined,
        image_width: undefined,
        original_filename: 'some-original-filename.jpg',
        mime_type: 'image/jpeg',
        file_size: 123456,
        storage_provider: 'local',
        storage_path: 'uploads/docs-photo-01.jpg',
        processing_status: 'pending',
        storage_url: undefined,
        thumbnail_generated: undefined,
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
