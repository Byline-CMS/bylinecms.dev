/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import assert from 'node:assert'
import { describe, it } from 'node:test'

import type { CollectionDefinition } from '@byline/core'
import { v7 as uuidv7 } from 'uuid'

import { flattenFields, reconstructFields } from '../storage-utils.js'

const DocsCollectionConfig: CollectionDefinition = {
  path: 'docs',
  labels: {
    singular: 'Document',
    plural: 'Documents',
  },
  fields: [
    { name: 'path', type: 'text', required: true, unique: true },
    { name: 'title', type: 'text', required: true, localized: true },
    { name: 'summary', type: 'text', required: true, localized: true },
    { name: 'category', type: 'relation', required: false },
    {
      name: 'publishedOn',
      type: 'datetime',
      mode: 'datetime',
      required: false,
    },
    {
      name: 'featured',
      label: 'Featured',
      type: 'checkbox',
      helpText: 'Is this page featured on the home page?',
    },
    { name: 'views', type: 'integer', required: false },
    { name: 'price', label: 'Price', type: 'decimal', required: false },

    {
      name: 'content',
      type: 'array',
      fields: [
        {
          name: 'richTextBlock',
          type: 'array',
          fields: [
            { name: 'constrainedWidth', type: 'boolean', required: false },
            { name: 'richText', type: 'richText', required: true, localized: true },
          ],
        },
        {
          name: 'photoBlock',
          type: 'array',
          fields: [
            { name: 'display', type: 'text', required: false },
            { name: 'photo', type: 'image', required: true },
            { name: 'alt', type: 'text', required: true, localized: false },
            { name: 'caption', type: 'richText', required: false, localized: true },
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
          type: 'array',
          fields: [
            { name: 'rating', type: 'integer', required: true },
            { name: 'comment', type: 'richText', required: true, localized: false },
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
}

const filedId = uuidv7()

// Complex test document with many fields and arrays
const sampleDocument = {
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
  // category: {
  //   target_collection_id: "cat-123",
  //   target_document_id: "electronics-audio"
  // },
  publishedOn: new Date('2024-01-15T10:00:00'),
  featured: true,
  views: 100,
  price: '19.99',
  content: [
    {
      richTextBlock: [
        { constrainedWidth: true },
        {
          richText: {
            en: { root: { paragraph: 'Some text here...' } },
            es: { root: { paragraph: 'Some spanish text here' } },
          },
        },
      ],
    },
    {
      photoBlock: [
        { display: 'wide' },
        {
          photo: {
            file_id: filedId,
            filename: 'docs-photo-01.jpg',
            original_filename: 'some-original-filename.jpg',
            mime_type: 'image/jpeg',
            file_size: 123456,
            storage_provider: 'local',
            storage_path: 'uploads/docs-photo-01.jpg',
          },
        },
        { alt: 'Some alt text here' },
        {
          caption: {
            en: { root: { paragraph: 'Some text here...' } },
            es: { root: { paragraph: 'Some spanish text here...' } },
          },
        },
      ],
    },
  ],
  reviews: [
    {
      reviewItem: [{ rating: 6 }, { comment: { root: { paragraph: 'Some review text here...' } } }],
    },
    {
      reviewItem: [
        { rating: 2 },
        { comment: { root: { paragraph: 'Some more reviews here...' } } },
      ],
    },
  ],
  links: [{ link: 'https://example.com' }, { link: 'https://another-example.com' }],
}

describe('01 Document Flattening and Reconstruction', () => {
  it('should flatten and reconstruct a document', () => {
    const flattened = flattenFields(sampleDocument, DocsCollectionConfig)
    assert(flattened, 'Flattened document should not be null or undefined')
    assert(flattened.length > 0, 'Flattened document should contain field values')
    console.log('Flattened document:', flattened)

    const reconstructed = reconstructFields(flattened)
    assert(reconstructed, 'Reconstructed document should not be null or undefined')
    const reconstructedJson = JSON.stringify(reconstructed, null, 2)
    // console.log('Reconstructed document:', reconstructedJson)

    // A simplified version of the sample document for deep equality check
    const sampleDocumentJson = JSON.stringify(sampleDocument, null, 2)

    assert.deepStrictEqual(
      JSON.parse(reconstructedJson),
      JSON.parse(sampleDocumentJson),
      'Reconstructed document should match the original structure'
    )
  })
})
