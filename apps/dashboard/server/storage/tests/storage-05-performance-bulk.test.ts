/**
 * Performance Comparison Tests - Optimized vs Original Storage Queries
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

// IMPORTANT NOTE!: depends on seed-bulk-documents.ts to have run 
// first to create the bulk collection and documents.

import { after, before, describe, it } from 'node:test'
import { setupTestDB, teardownTestDB } from '../../lib/test-helper.js';

// Test database setup
let queryBuilders: ReturnType<typeof import('../storage-queries.js').createQueryBuilders>

// Global test variables
let collection: {
  id: string;
  path: string;
  singular: string;
  plural: string;
  config: unknown;
  created_at: Date | null;
  updated_at: Date | null;
} | undefined

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

      const documents = await queryBuilders.documents.getAllDocuments
        ({
          collection_id: collection.id,
          locale: 'all'
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

      const result = await queryBuilders.documents.getDocumentsByPage(
        {
          collection_id: collection.id,
          locale: 'en',
          page: 1,
          page_size: 50,
          order: 'created_at',
          desc: true
        }
      )

      const endTime = performance.now()
      const duration = endTime - startTime

      console.log(`All documents for collection by page: ${duration.toFixed(2)}ms`)
      console.log('Retrieved documents:', result.documents.length)
      console.log('Sample document:', JSON.stringify(result.documents[0], null, 2))
    })
  })
})