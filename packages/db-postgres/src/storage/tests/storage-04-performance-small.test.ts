/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import assert from 'node:assert'
import { after, before, describe, it } from 'node:test'

import type { CollectionDefinition } from '@byline/core'

import { setupTestDB, teardownTestDB } from '../../lib/test-helper.js'

// Test database setup
let commandBuilders: ReturnType<typeof import('../storage-commands.js').createCommandBuilders>
let queryBuilders: ReturnType<typeof import('../storage-queries.js').createQueryBuilders>

// Complex test collection configuration
const ComplexCollectionConfig: CollectionDefinition = {
  path: 'products',
  labels: {
    singular: 'Product',
    plural: 'Products',
  },
  fields: [
    { name: 'sku', type: 'text', required: true, unique: true },
    { name: 'name', type: 'text', required: true, localized: true },
    { name: 'description', type: 'richText', required: true, localized: true },
    { name: 'price', type: 'decimal', required: true },
    { name: 'inStock', type: 'boolean', required: true },
    { name: 'releaseDate', type: 'datetime', required: false },
    { name: 'category', type: 'relation', targetCollection: 'categories', required: false },
    {
      name: 'images',
      type: 'array',
      fields: [
        {
          name: 'imageItem',
          type: 'array',
          fields: [
            { name: 'url', type: 'file', required: true },
            { name: 'alt', type: 'text', required: true, localized: true },
            { name: 'caption', type: 'text', required: false, localized: true },
          ],
        },
      ],
    },
    {
      name: 'specifications',
      type: 'array',
      fields: [
        {
          name: 'specificationItem',
          type: 'array',
          fields: [
            { name: 'key', type: 'text', required: true, localized: true },
            { name: 'value', type: 'text', required: true, localized: true },
            { name: 'unit', type: 'text', required: false },
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
  ],
}

// Complex test document with many fields and arrays
const complexProductDocument = {
  sku: 'PROD-12345',
  name: {
    en: 'Premium Wireless Headphones',
    es: 'Auriculares Inalámbricos Premium',
    fr: 'Casque Sans Fil Premium',
  },
  description: {
    en: {
      type: 'paragraph',
      content: [{ type: 'text', text: 'High-quality wireless headphones with noise cancellation' }],
    },
    es: {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Auriculares inalámbricos de alta calidad con cancelación de ruido' },
      ],
    },
    fr: {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Casque sans fil de haute qualité avec suppression du bruit' },
      ],
    },
  },
  price: 299.99,
  inStock: true,
  releaseDate: new Date('2024-01-15T10:00:00Z'),
  images: [
    {
      imageItem: [
        {
          image: {
            file_id: '018dd0b2-9a2a-7f01-b8b2-a0c719d0f5b3',
            filename: 'headphones-main.jpg',
            original_filename: 'wireless-headphones.jpg',
            mime_type: 'image/jpeg',
            file_size: 2048000,
            storage_provider: 's3',
            storage_path: '/products/img-001.jpg',
          },
        },
        {
          alt: {
            en: 'Premium wireless headphones front view',
            es: 'Vista frontal de auriculares inalámbricos premium',
            fr: 'Vue de face du casque sans fil premium',
          },
        },
        {
          caption: {
            en: 'Sleek design with premium materials',
            es: 'Diseño elegante con materiales premium',
            fr: 'Design élégant avec des matériaux premium',
          },
        },
      ],
    },
    {
      imageItem: [
        {
          image: {
            file_id: '018dd0b2-9a2a-7f02-8e73-f4c5a9e3d6b8',
            filename: 'headphones-side.jpg',
            original_filename: 'side-view.jpg',
            mime_type: 'image/jpeg',
            file_size: 1536000,
            storage_provider: 's3',
            storage_path: '/products/img-002.jpg',
          },
        },
        {
          alt: {
            en: 'Side view showing comfort padding',
            es: 'Vista lateral mostrando acolchado cómodo',
            fr: 'Vue de côté montrant le rembourrage confortable',
          },
        },
        {
          caption: {
            en: 'Side view showing comfort padding',
            es: 'Vista lateral mostrando acolchado cómodo',
            fr: 'Vue de côté montrant le rembourrage confortable',
          },
        },
      ],
    },
  ],
  specifications: [
    {
      specificationItem: [
        {
          key: {
            en: 'Battery Life',
            es: 'Duración de la Batería',
            fr: 'Autonomie de la Batterie',
          },
        },
        {
          value: {
            en: '30 hours',
            es: '30 horas',
            fr: '30 heures',
          },
        },
        {
          unit: 'hours',
        },
      ],
    },
    {
      specificationItem: [
        {
          key: {
            en: 'Weight',
            es: 'Peso',
            fr: 'Poids',
          },
        },
        {
          value: {
            en: '250g',
            es: '250g',
            fr: '250g',
          },
        },
        {
          unit: 'grams',
        },
      ],
    },
    {
      specificationItem: [
        {
          key: {
            en: 'Driver Size',
            es: 'Tamaño del Driver',
            fr: 'Taille du Haut-parleur',
          },
        },
        {
          value: {
            en: '40mm',
            es: '40mm',
            fr: '40mm',
          },
        },
        {
          unit: 'mm',
        },
      ],
    },
  ],
  reviews: [
    {
      reviewItem: [{ rating: 5 }, { comment: { root: { paragraph: 'Some review text here...' } } }],
    },
    {
      reviewItem: [
        { rating: 3 },
        { comment: { root: { paragraph: 'Some more reviews here...' } } },
      ],
    },
  ],
}

// Global test variables
let testCollection: { id: string; name: string } = {} as any
const testDocumentsVersionIds: string[] = []

describe('04 Performance Small Sets', () => {
  before(async () => {
    // Connect to test database
    const testDB = setupTestDB()
    commandBuilders = testDB.commandBuilders
    queryBuilders = testDB.queryBuilders

    // Create test collection
    const timestamp = Date.now()
    const result = await commandBuilders.collections.create(
      `products_collection_${timestamp}`,
      ComplexCollectionConfig
    )

    const collection = result[0]

    if (collection == null) {
      throw new Error('Failed to create test collection')
    }

    testCollection = { id: collection.id, name: collection.path }
    console.log('Test product collection created:', testCollection)

    // Create multiple test documents for batch testing
    for (let i = 0; i < 10; i++) {
      const docData = structuredClone(complexProductDocument)
      docData.sku = `PROD-${12345 + i}`
      docData.name.en = `Product ${i + 1}`

      const result = await commandBuilders.documents.createDocumentVersion({
        collectionId: testCollection.id,
        collectionConfig: ComplexCollectionConfig,
        action: 'create',
        documentData: docData,
        path: docData.sku,
      })

      testDocumentsVersionIds.push(result.document.id)
    }
  })

  after(async () => {
    // Clean up test collection (cascades to documents)
    try {
      await commandBuilders.collections.delete(testCollection.id)
      console.log('Test collection and documents cleaned up')
    } catch (error) {
      console.error('Failed to cleanup test collection:', error)
    }

    await teardownTestDB()
  })

  describe('Single Document Retrieval Performance', () => {
    it('should retrieve document using optimized approach', async () => {
      const startTime = performance.now()

      const document = await queryBuilders.documents.getDocumentByVersion({
        document_version_id: testDocumentsVersionIds[0] as string,
        locale: 'all',
      })

      const endTime = performance.now()
      const duration = endTime - startTime

      console.log(`Optimized approach: ${duration.toFixed(2)}ms`)
      console.log('Document structure:', Object.keys(document))
      console.log('Images array length:', document.images?.length)
      console.log('Specifications array length:', document.specifications?.length)
      console.log('Reviews array length:', document.reviews?.length)

      // Verify we got the complete document
      console.log('Sample name localization:', document.name)
      console.log('Sample specification:', document.specifications?.[0])
    })

    it('should compare single document performance over multiple runs', async () => {
      const runs = 5
      let optimizedTotal = 0

      console.log(`\nRunning ${runs} performance tests...`)

      for (let i = 0; i < runs; i++) {
        // Test optimized approach
        const optimizedStart = performance.now()
        await queryBuilders.documents.getDocumentByVersion({
          document_version_id: testDocumentsVersionIds[
            i % testDocumentsVersionIds.length
          ] as string,
          locale: 'all',
        })
        const optimizedEnd = performance.now()
        optimizedTotal += optimizedEnd - optimizedStart
      }

      const optimizedAvg = optimizedTotal / runs

      console.log(`\nPerformance Results (${runs} runs):`)
      console.log(`Optimized average: ${optimizedAvg.toFixed(2)}ms`)
    })
  })

  describe('Batch Document Retrieval Performance', () => {
    it('should retrieve multiple documents using optimized batch approach', async () => {
      const batchSize = 5
      const documentVersionIds = testDocumentsVersionIds.slice(0, batchSize)

      const startTime = performance.now()

      const documents = await queryBuilders.documents.getDocuments({
        document_version_ids: documentVersionIds,
        locale: 'all',
      })

      const endTime = performance.now()
      const duration = endTime - startTime

      console.log(`Optimized batch (${batchSize} docs): ${duration.toFixed(2)}ms`)
      console.log(`Average per document: ${(duration / batchSize).toFixed(2)}ms`)
      console.log('Retrieved documents:', Object.keys(documents).length)

      assert.strictEqual(
        documents.length,
        batchSize,
        'Batch retrieval should return correct number of documents'
      )
    })

    it('should compare batch retrieval performance', async () => {
      const batchSizes = [3, 5, 10]

      console.log('\nBatch Performance Comparison:')
      console.log('Batch Size | Performance')
      console.log('-----------|----------')

      for (const batchSize of batchSizes) {
        const documentIds = testDocumentsVersionIds.slice(
          0,
          Math.min(batchSize, testDocumentsVersionIds.length)
        )

        // Optimized approach (batch)
        const optimizedStart = performance.now()
        await queryBuilders.documents.getDocuments({
          document_version_ids: documentIds,
          locale: 'all',
        })
        const optimizedEnd = performance.now()
        const optimizedDuration = optimizedEnd - optimizedStart

        console.log(
          `${batchSize.toString().padStart(10)} | ${optimizedDuration.toFixed(0).padStart(9)}ms`
        )
      }
    })
  })

  describe('Locale-Specific Retrieval Performance', () => {
    it('should test locale-specific retrieval performance', async () => {
      const locales = ['en', 'es', 'fr', 'all']

      console.log('\nLocale Performance Comparison:')
      console.log('Locale | Performance')
      console.log('-------|----------')

      for (const locale of locales) {
        // Optimized approach
        const optimizedStart = performance.now()
        await queryBuilders.documents.getDocumentByVersion({
          document_version_id: testDocumentsVersionIds[0] as string, // Use first document for testing
          locale,
        })
        const optimizedEnd = performance.now()
        const optimizedDuration = optimizedEnd - optimizedStart

        console.log(`${locale.padStart(6)} | ${optimizedDuration.toFixed(0).padStart(9)}ms`)
      }
    })
  })

  describe('Memory Usage and Result Verification', () => {
    it('should estimate memory usage difference', async () => {
      const memBefore = process.memoryUsage()

      // Load multiple documents to see memory impact
      const documents: any[] = []
      for (let i = 0; i < 5; i++) {
        const doc = await queryBuilders.documents.getDocumentByVersion({
          document_version_id: testDocumentsVersionIds[i] as string,
          locale: 'all',
        })
        documents.push(doc)
      }

      const memAfter = process.memoryUsage()

      console.log('Memory usage for 5 complex documents:')
      console.log(
        `Heap used: ${((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(2)} MB`
      )
      console.log(
        `External: ${((memAfter.external - memBefore.external) / 1024 / 1024).toFixed(2)} MB`
      )
      console.log(
        `Approx per document: ${((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024 / 5).toFixed(2)} MB`
      )
    })
  })
})
