/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// IMPORTANT NOTE!: depends on seed-bulk-documents.ts to have run
// first to create the bulk collection and documents.

import { after, before, describe, it } from 'node:test'

import { setupTestDB, teardownTestDB } from '../../lib/test-helper.js'

// Test database setup
let queryBuilders: ReturnType<typeof import('../storage-queries.js').createQueryBuilders>

// Global test variables
let collection:
  | {
      id: string
      path: string
      singular: string
      plural: string
      config: unknown
      created_at: Date | null
      updated_at: Date | null
    }
  | undefined

describe('05 Performance Bulk Tests', () => {
  before(async () => {
    // Connect to test database
    const testDB = setupTestDB()
    queryBuilders = testDB.queryBuilders

    // Get bulk collection
    collection = await queryBuilders.collections.getCollectionByPath('docs')
    if (collection == null) {
      throw new Error('Bulk collection not found. Please run seed-bulk-documents.ts first.')
    }
    console.log('Bulk collection retrieved:', collection)
  })

  after(async () => {
    await teardownTestDB()
  })

  describe('Get Documents for Collection', () => {
    it('get all documents for collection', async () => {
      if (collection == null) {
        throw new Error('Collection is not defined. Please run seed-bulk-documents.ts first.')
      }

      const startTime = performance.now()

      const documents = await queryBuilders.documents.getAllDocuments({
        collection_id: collection.id,
        locale: 'all',
      })

      const endTime = performance.now()
      const duration = endTime - startTime

      console.log(`All documents for collection: ${duration.toFixed(2)}ms`)
      console.log('Retrieved documents:', documents.length)
      console.log('Sample document:', documents[0])
    })
    it('get all documents for collection by page', async () => {
      if (collection == null) {
        throw new Error('Collection is not defined. Please run seed-bulk-documents.ts first.')
      }

      const startTime = performance.now()

      const result = await queryBuilders.documents.getDocumentsByPage({
        collection_id: collection.id,
        locale: 'en',
        page: 1,
        page_size: 50,
        order: 'created_at',
        desc: true,
      })

      const endTime = performance.now()
      const duration = endTime - startTime

      console.log(`All documents for collection by page: ${duration.toFixed(2)}ms`)
      console.log('Retrieved documents:', result.documents.length)
      console.log('Sample document:', JSON.stringify(result.documents[0], null, 2))
    })
  })
})
