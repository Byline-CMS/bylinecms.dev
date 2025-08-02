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

import assert from 'node:assert';
import { after, before, describe, it } from 'node:test'
import type { CollectionDefinition } from '@byline/core'
import { v7 as uuidv7 } from 'uuid'
import { setupTestDB, teardownTestDB } from '../../lib/test-helper.js';

// Test database setup
let commandBuilders: ReturnType<typeof import('../storage-commands.js').createCommandBuilders>
let queryBuilders: ReturnType<typeof import('../storage-queries.js').createQueryBuilders>

const FieldTypesCollectionConfig: CollectionDefinition = {
  path: 'field-types',
  labels: {
    singular: 'FieldTypes',
    plural: 'FieldType',
  },
  fields: [
    { name: 'path', type: 'text', required: true, unique: true },
    { name: 'title', type: 'text', required: true, localized: true },
    { name: 'summary', type: 'text', required: true, localized: true },
    { name: 'publishedOn', type: 'datetime', required: false },
    { name: 'views', type: 'integer', required: false },
    { name: 'price', type: 'decimal', required: false },
    { name: 'attachment', type: 'file', required: false },
  ],
};

let filedId = uuidv7()

// Complex test document with many fields and arrays
const sampleDocument = {
  path: "my-first-document",
  title: {
    en: "My First Document",
    es: "Mi Primer Documento",
    fr: "Mon Premier Document"
  },
  summary: {
    en: "This is a sample document for testing purposes.",
    es: "Este es un documento de muestra para fines de prueba.",
    fr: "Il s'agit d'un document d'exemple à des fins de test."
  },
  // category: {
  //   target_collection_id: "cat-123",
  //   target_document_id: "electronics-audio"
  // },
  publishedOn: new Date("2024-01-15T10:00:00"),
  views: 100,
  price: '19.99',
  attachment: {
    file_id: filedId,
    filename: "sample-attachment.pdf",
    original_filename: "sample-document.pdf",
    file_size: 102400, // 100 KB
    mime_type: "application/pdf",
    storage_provider: 'local',
    storage_path: 'uploads/attachments/sample-attachment.pdf',
  },
};

// Global test variables
let testCollection: { id: string; name: string } = {} as any

describe('02 Field Types', () => {
  before(async () => {
    // Connect to test database
    const testDB = setupTestDB()
    commandBuilders = testDB.commandBuilders
    queryBuilders = testDB.queryBuilders

    // Create test collection
    const timestamp = Date.now()
    const collection = await commandBuilders.collections.create(
      `field_types_collection_${timestamp}`,
      FieldTypesCollectionConfig
    )

    testCollection = { id: collection[0].id, name: collection[0].path }
    console.log('Test collection created:', testCollection)
  })

  after(async () => {
    // Clean up test collection (cascades to documents and fields)
    try {
      await commandBuilders.collections.delete(testCollection.id)
      console.log('Test collection and documents cleaned up')
    } catch (error) {
      console.error('Failed to cleanup test collection:', error)
    }

    await teardownTestDB()
  })

  it('should create and return a field type document', async () => {

    const sourceDocument = structuredClone(sampleDocument)
    sourceDocument.path = `my-first-field-types-document-${Date.now()}` // Ensure unique path

    const result = await commandBuilders.documents.createDocument({
      collectionId: testCollection.id,
      collectionConfig: FieldTypesCollectionConfig,
      action: 'create',
      documentData: sourceDocument,
      path: sourceDocument.path,
    })

    console.log('Created document:', result)

    const document = await queryBuilders.documents.getDocumentByVersion({
      document_version_id: result.document.id
    })

    console.log('Retrieved document:', document)
  })
})
