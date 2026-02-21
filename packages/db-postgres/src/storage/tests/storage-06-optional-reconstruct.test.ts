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
let collectionId: string

describe('06 Optional Document Reconstruction', () => {
  before(async () => {
    // Connect to test database
    const testDB = setupTestDB()
    queryBuilders = testDB.queryBuilders

    // Get bulk collection
    const collection = await queryBuilders.collections.getCollectionByPath('docs')
    if (collection == null) {
      throw new Error('Bulk collection not found. Please run seed-bulk-documents.ts first.')
    }
    collectionId = collection.id
  })

  after(async () => {
    await teardownTestDB()
  })

  describe('Get documents in reconstructed and flattened forms for all locales', () => {
    it('get a documents in reconstructed form for all locales', async () => {
      const result = await queryBuilders.documents.getDocumentsByPage({
        collection_id: collectionId,
        locale: 'all',
      })

      if (result.documents.length === 0) {
        throw new Error('No documents found for the collection.')
      }

      const _document = await queryBuilders.documents.getDocumentById({
        collection_id: collectionId,
        document_id: result.documents[0].document_id,
        locale: 'all',
      })

      // console.log('Sample reconstructed document:', JSON.stringify(document, null, 2))
    })

    it('get a documents in flattened form for all locales', async () => {
      const result = await queryBuilders.documents.getDocumentsByPage({
        collection_id: collectionId,
        locale: 'all',
      })

      if (result.documents.length === 0) {
        throw new Error('No documents found for the collection.')
      }

      const _document = await queryBuilders.documents.getDocumentById({
        collection_id: collectionId,
        document_id: result.documents[0].document_id,
        locale: 'all',
        reconstruct: false,
      })

      // console.log('Sample flattened document:', JSON.stringify(document, null, 2))
    })
  })

  describe('Get documents in reconstructed and flattened forms for en locale', () => {
    it('get a documents in reconstructed form for en locale', async () => {
      const result = await queryBuilders.documents.getDocumentsByPage({
        collection_id: collectionId,
        locale: 'en',
      })

      if (result.documents.length === 0) {
        throw new Error('No documents found for the collection.')
      }

      const _document = await queryBuilders.documents.getDocumentById({
        collection_id: collectionId,
        document_id: result.documents[0].document_id,
        locale: 'en',
      })

      // console.log('Sample reconstructed document:', JSON.stringify(document, null, 2))
    })

    it('get a documents in flattened form for en locale', async () => {
      const result = await queryBuilders.documents.getDocumentsByPage({
        collection_id: collectionId,
        locale: 'en',
      })

      if (result.documents.length === 0) {
        throw new Error('No documents found for the collection.')
      }

      const _document = await queryBuilders.documents.getDocumentById({
        collection_id: collectionId,
        document_id: result.documents[0].document_id,
        locale: 'en',
        reconstruct: false,
      })

      // console.log('Sample flattened document:', JSON.stringify(document, null, 2))
    })
  })
})
