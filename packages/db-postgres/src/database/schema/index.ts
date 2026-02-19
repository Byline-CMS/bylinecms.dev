/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { eq, relations, sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  date,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  pgView,
  real,
  text,
  time,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

// Collections table
export const collections = pgTable('collections', {
  id: uuid('id').primaryKey(),
  path: varchar('path', { length: 255 }).unique().notNull(),
  singular: text('singular').notNull(), // Singular label for the collection
  plural: text('plural').notNull(), // Plural label for the collection
  config: jsonb('config').notNull(), // Store CollectionConfig
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
})

// Documents table
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey(),
    collection_id: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    created_at: timestamp('created_at').defaultNow(),
    updated_at: timestamp('updated_at').defaultNow(),
  },
  (table) => [index('idx_documents_collection').on(table.collection_id)]
)

// Document versions table
export const documentVersions = pgTable(
  'document_versions',
  {
    id: uuid('id').primaryKey(), // UUIDv7 versioning by default
    document_id: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    collection_id: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    path: varchar('path', { length: 255 }).notNull(), // Can change between versions
    doc: jsonb('doc'), // optionally store the original document
    event_type: varchar('event_type', { length: 20 }).notNull().default('create'), // 'create', 'update', 'delete'
    status: varchar('status', { length: 50 }).default('draft'),
    is_deleted: boolean('is_deleted').default(false), // Tombstone for soft deletes
    created_at: timestamp('created_at').defaultNow(),
    updated_at: timestamp('updated_at').defaultNow(),
    created_by: uuid('created_by'),
    change_summary: text('change_summary'),
  },
  (table) => [
    // Index for finding all versions of a logical document
    index('idx_documents_document_id').on(table.document_id),
    // Index for current document lookup by path
    index('idx_documents_collection_path_deleted').on(
      table.collection_id,
      table.path,
      table.is_deleted
    ),
    // Index for current document lookup by logical document ID
    index('idx_documents_collection_document_deleted').on(
      table.collection_id,
      table.document_id,
      table.is_deleted
    ),
    // Index to optimize the current documents view
    index('idx_documents_current_view').on(
      table.collection_id,
      table.document_id,
      table.is_deleted,
      table.id
    ),
    // Event and audit indexes
    index('idx_documents_event_type').on(table.event_type),
    index('idx_documents_created_at').on(table.created_at),
    // Ensure logical document belongs to only one collection
    index('idx_documents_document_collection').on(table.document_id, table.collection_id),
    // Ensure unique path per collection (for undeleted documents)
    // unique('unique_document_path').on(table.collection_id, table.document_id, table.path, table.is_deleted),
  ]
)

// Document Relationships (Parent/Child) - Many-to-Many
export const documentRelationships = pgTable(
  'document_relationships',
  {
    // Note: These reference the logical `document_id`, not the version `id`.
    // Foreign key constraints are not used; integrity is handled at the application layer.
    parent_document_id: uuid('parent_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    child_document_id: uuid('child_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    created_at: timestamp('created_at').defaultNow(),
  },
  (table) => [
    // Composite primary key to ensure a child is only parented once by the same parent.
    unique().on(table.parent_document_id, table.child_document_id),
    // Indexes for efficient lookups of children and parents.
    index('idx_document_relationships_parent').on(table.parent_document_id),
    index('idx_document_relationships_child').on(table.child_document_id),
  ]
)

// Current Documents View - gets latest version of each logical document
// NOTE: This does not work as selectDistinct is based on the entire row,
// and not just the document_id.
// export const currentDocumentsView = pgView("current_documents").as((qb) => {
//   return qb
//     .selectDistinct({
//       id: documents.id, // Version ID
//       document_id: documents.document_id, // Logical document ID
//       collection_id: documents.collection_id,
//       path: documents.path,
//       event_type: documents.event_type,
//       status: documents.status,
//       is_deleted: documents.is_deleted,
//       created_at: documents.created_at,
//       updated_at: documents.updated_at,
//       created_by: documents.created_by,
//       change_summary: documents.change_summary,
//     })
//     .from(documents)
//     .where(eq(documents.is_deleted, false))
//     .orderBy(
//       documents.collection_id,
//       documents.document_id,
//       desc(documents.id) // Latest version (UUIDv7) first
//     );
// });

// Current Documents View - gets latest version of each logical document
// based on ROW_NUMBER() window function.
// Or would this be better implemented as raw DISTINCT ON?
export const currentDocumentsView = pgView('current_documents').as((qb) => {
  const sq = qb.$with('sq').as(
    qb
      .select({
        id: documentVersions.id,
        document_id: documentVersions.document_id,
        collection_id: documentVersions.collection_id,
        path: documentVersions.path,
        event_type: documentVersions.event_type,
        status: documentVersions.status,
        is_deleted: documentVersions.is_deleted,
        created_at: documentVersions.created_at,
        updated_at: documentVersions.updated_at,
        created_by: documentVersions.created_by,
        change_summary: documentVersions.change_summary,
        rn: sql<number>`row_number() OVER (PARTITION BY ${documentVersions.document_id} ORDER BY ${documentVersions.id} DESC)`.as(
          'rn'
        ),
      })
      .from(documentVersions)
      .where(eq(documentVersions.is_deleted, false))
  )
  return qb
    .with(sq)
    .select({
      id: sq.id,
      document_id: sq.document_id,
      collection_id: sq.collection_id,
      path: sq.path,
      event_type: sq.event_type,
      status: sq.status,
      is_deleted: sq.is_deleted,
      created_at: sq.created_at,
      updated_at: sq.updated_at,
      created_by: sq.created_by,
      change_summary: sq.change_summary,
    })
    .from(sq)
    .where(eq(sq.rn, 1))
})

// Base field values structure
const baseStoreColumns = {
  id: uuid('id').primaryKey(),
  document_version_id: uuid('document_version_id')
    .references(() => documentVersions.id, { onDelete: 'cascade' })
    .notNull(), // References the version ID
  collection_id: uuid('collection_id')
    .references(() => collections.id, { onDelete: 'cascade' })
    .notNull(), // For cross-collection queries
  field_path: varchar('field_path', { length: 500 }).notNull(),
  field_name: varchar('field_name', { length: 255 }).notNull(),
  locale: varchar('locale', { length: 10 }).notNull().default('default'),
  parent_path: varchar('parent_path', { length: 500 }),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
}

// 1. TEXT FIELDS TABLE
export const textStore = pgTable(
  'store_text',
  {
    ...baseStoreColumns,

    value: text('value').notNull(),
    word_count: integer('word_count'), // Pre-computed for analytics
  },
  (table) => [
    // Optimized indexes for text operations
    index('idx_text_value').on(table.value),
    index('idx_text_fulltext').using('gin', sql`to_tsvector('english', ${table.value})`),
    index('idx_text_locale_value').on(table.locale, table.value),
    index('idx_text_path_value').on(table.field_path, table.value),
    // Unique constraints for unique fields
    unique('unique_text_field').on(table.document_version_id, table.field_path, table.locale),
  ]
)

// 2. NUMERIC FIELDS TABLE
export const numericStore = pgTable(
  'store_numeric',
  {
    ...baseStoreColumns,

    // Store the original number type for reconstruction
    number_type: varchar('number_type', { length: 20 }).notNull(), // 'integer', 'decimal', 'float'

    value_integer: integer('value_integer'),
    value_decimal: decimal('value_decimal', { precision: 10, scale: 2 }),
    value_float: real('value_float'),
  },
  (table) => [
    // Optimized indexes for numeric operations
    index('idx_numeric_integer').on(table.value_integer),
    index('idx_numeric_decimal').on(table.value_decimal),
    index('idx_numeric_float').on(table.value_float),

    // Range indexes for common queries
    index('idx_numeric_integer_range').on(table.field_path, table.value_integer),
    index('idx_numeric_decimal_range').on(table.field_path, table.value_decimal),

    unique('unique_numeric_field').on(table.document_version_id, table.field_path, table.locale),
  ]
)

// 3. BOOLEAN FIELDS TABLE
export const booleanStore = pgTable(
  'store_boolean',
  {
    ...baseStoreColumns,

    value: boolean('value').notNull(),
  },
  (table) => [
    // Simple but effective indexes for boolean queries
    index('idx_boolean_value').on(table.value),
    index('idx_boolean_path_value').on(table.field_path, table.value),
    index('idx_boolean_collection_value').on(table.collection_id, table.field_path, table.value),
    unique('unique_boolean_field').on(table.document_version_id, table.field_path, table.locale),
  ]
)

// 4. DATE/TIME FIELDS TABLE
export const datetimeStore = pgTable(
  'store_datetime',
  {
    ...baseStoreColumns,

    // Store the original date type for reconstruction
    date_type: varchar('date_type', { length: 20 }).notNull(), // 'date', 'time', 'timestamptz'

    value_date: date('value_date'),
    value_time: time('value_time'),
    value_timestamp_tz: timestamp('value_timestamp_tz', { withTimezone: true }),
  },
  (table) => [
    // Optimized for date range queries
    index('idx_datetime_date').on(table.value_date),
    index('idx_datetime_timestamp_tz').on(table.value_timestamp_tz),
    // Common date query patterns
    index('idx_datetime_path_date').on(table.field_path, table.value_timestamp_tz),
    index('idx_datetime_collection_date').on(table.collection_id, table.value_timestamp_tz),
    unique('unique_datetime_field').on(table.document_version_id, table.field_path, table.locale),
  ]
)

// 5. RELATION FIELDS TABLE
export const relationStore = pgTable(
  'store_relation',
  {
    ...baseStoreColumns,

    target_document_id: uuid('target_document_id')
      .references(() => documents.id)
      .notNull(),

    target_collection_id: uuid('target_collection_id')
      .references(() => collections.id)
      .notNull(),

    // Relationship metadata
    relationship_type: varchar('relationship_type', { length: 50 }).default('reference'), // 'reference', 'embed', 'weak'
    cascade_delete: boolean('cascade_delete').default(false),
  },
  (table) => [
    // Critical indexes for relationship queries
    index('idx_relation_target_document').on(table.target_document_id),
    index('idx_relation_target_collection').on(table.target_collection_id),
    index('idx_relation_type').on(table.relationship_type),

    // Reverse relationship lookup
    index('idx_relation_reverse').on(table.target_document_id, table.field_path),

    // Cross-collection relationship queries
    index('idx_relation_collection_to_collection').on(
      table.collection_id,
      table.target_collection_id
    ),

    unique('unique_relation_field').on(table.document_version_id, table.field_path, table.locale),
  ]
)

// Generic meta store for document nodes (blocks, array items, fields, etc.)
// This allows attaching durable IDs and arbitrary metadata to any node
// in a document tree, keyed by document version and path.
export const metaStore = pgTable(
  'store_meta',
  {
    id: uuid('id').primaryKey(),
    document_version_id: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    collection_id: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),

    // Node classification and linkage back into the reconstructed tree.
    type: text('type').notNull(),
    path: text('path').notNull(),

    // Durable identifier for this item within a document version. This is the
    // ID exposed to the dashboard/API for blocks, array items, etc.
    item_id: varchar('item_id', { length: 255 }).notNull(),

    // Optional opaque metadata payload for this node. Common attributes like
    // label, icon, collapsed state, etc. can be stored here.
    meta: jsonb('meta'),

    created_at: timestamp('created_at').defaultNow(),
    updated_at: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    // Fast lookup by document and node type/path when enriching reconstructed
    // trees with meta information.
    index('idx_meta_document_type_path').on(table.document_version_id, table.type, table.path),
    // Resolve durable IDs (e.g. for array.move by item_id) back to a node path.
    index('idx_meta_item_id').on(table.item_id),
    // Support queries scoped by collection and type (e.g. all blocks in a collection).
    index('idx_meta_collection_type').on(table.collection_id, table.type),
    // Ensure only a single meta row exists for a given node in a document version.
    unique('unique_meta_node').on(table.document_version_id, table.type, table.path),
  ]
)

// 6. FILE FIELDS TABLE (Your composite type example)
export const fileStore = pgTable(
  'store_file',
  {
    ...baseStoreColumns,

    // File identity
    file_id: uuid('file_id').notNull(), // Reference to file storage system
    filename: varchar('filename', { length: 255 }).notNull(),
    original_filename: varchar('original_filename', { length: 255 }).notNull(),

    // File metadata
    mime_type: varchar('mime_type', { length: 100 }).notNull(),
    file_size: bigint('file_size', { mode: 'number' }).notNull(), // Size in bytes
    file_hash: varchar('file_hash', { length: 64 }), // SHA-256 hash for deduplication

    // Storage information
    storage_provider: varchar('storage_provider', { length: 50 }).notNull(), // 'local', 's3', 'gcs', etc.
    storage_path: text('storage_path').notNull(),
    storage_url: text('storage_url'), // CDN or direct URL

    // Image-specific metadata (when applicable)
    image_width: integer('image_width'),
    image_height: integer('image_height'),
    image_format: varchar('image_format', { length: 20 }),

    // File processing status
    processing_status: varchar('processing_status', { length: 20 }).default('pending'), // 'pending', 'processing', 'completed', 'failed'
    thumbnail_generated: boolean('thumbnail_generated').default(false),
  },
  (table) => [
    // File-specific indexes
    index('idx_file_file_id').on(table.file_id),
    index('idx_file_mime_type').on(table.mime_type),
    index('idx_file_size').on(table.file_size),
    index('idx_file_hash').on(table.file_hash),

    // Image queries
    index('idx_file_image_dimensions').on(table.image_width, table.image_height),

    // Storage queries
    index('idx_file_storage_provider').on(table.storage_provider),
    index('idx_file_processing_status').on(table.processing_status),

    unique('unique_file_field').on(table.document_version_id, table.field_path, table.locale),
  ]
)

// 7. JSON/STRUCTURED DATA FIELDS TABLE
export const jsonStore = pgTable(
  'store_json',
  {
    ...baseStoreColumns,

    value: jsonb('value').notNull(),
    // JSON metadata for optimization
    json_schema: varchar('json_schema', { length: 100 }), // Schema identifier for validation
    object_keys: text('object_keys').array(), // Array of top-level keys for indexing
  },
  (table) => [
    // JSONB indexes
    index('idx_json_value_gin').using('gin', table.value),
    index('idx_json_schema').on(table.json_schema),
    index('idx_json_keys').using('gin', table.object_keys),

    unique('unique_json_field').on(table.document_version_id, table.field_path, table.locale),
  ]
)

// RELATIONS
// =========

export const collectionsRelations = relations(collections, ({ many }) => ({
  documents: many(documentVersions),
  text_values: many(textStore),
  numeric_values: many(numericStore),
  boolean_values: many(booleanStore),
  datetime_values: many(datetimeStore),
  relation_values: many(relationStore, { relationName: 'source_collection' }),
  file_values: many(fileStore),
  json_values: many(jsonStore),
}))

export const documentsRelations = relations(documentVersions, ({ one, many }) => ({
  collection: one(collections, {
    fields: [documentVersions.collection_id],
    references: [collections.id],
  }),
  // Relations for parent/child documents
  // A document can be a child in many relationships. This finds the links.
  parent_relationships: many(documentRelationships, { relationName: 'child' }),
  // A document can be a parent in many relationships. This finds the links.
  child_relationships: many(documentRelationships, { relationName: 'parent' }),
  // Relations for field values
  text_values: many(textStore),
  numeric_values: many(numericStore),
  boolean_values: many(booleanStore),
  datetime_values: many(datetimeStore),
  relation_values: many(relationStore),
  file_values: many(fileStore),
  json_values: many(jsonStore),
}))

export const documentRelationshipsRelations = relations(documentRelationships, ({ one }) => ({
  parent: one(documentVersions, {
    fields: [documentRelationships.parent_document_id],
    references: [documentVersions.document_id],
    relationName: 'parent',
  }),
  child: one(documentVersions, {
    fields: [documentRelationships.child_document_id],
    references: [documentVersions.document_id],
    relationName: 'child',
  }),
}))

// Field value relations
export const textStoreRelations = relations(textStore, ({ one }) => ({
  document: one(documentVersions, {
    fields: [textStore.document_version_id],
    references: [documentVersions.id],
  }),
  collection: one(collections, {
    fields: [textStore.collection_id],
    references: [collections.id],
  }),
}))

export const numericStoreRelations = relations(numericStore, ({ one }) => ({
  document: one(documentVersions, {
    fields: [numericStore.document_version_id],
    references: [documentVersions.id],
  }),
  collection: one(collections, {
    fields: [numericStore.collection_id],
    references: [collections.id],
  }),
}))

export const booleanStoreRelations = relations(booleanStore, ({ one }) => ({
  document: one(documentVersions, {
    fields: [booleanStore.document_version_id],
    references: [documentVersions.id],
  }),
  collection: one(collections, {
    fields: [booleanStore.collection_id],
    references: [collections.id],
  }),
}))

export const datetimeStoreRelations = relations(datetimeStore, ({ one }) => ({
  document: one(documentVersions, {
    fields: [datetimeStore.document_version_id],
    references: [documentVersions.id],
  }),
  collection: one(collections, {
    fields: [datetimeStore.collection_id],
    references: [collections.id],
  }),
}))

export const relationStoreRelations = relations(relationStore, ({ one }) => ({
  document: one(documentVersions, {
    fields: [relationStore.document_version_id],
    references: [documentVersions.id],
  }),
  collection: one(collections, {
    fields: [relationStore.collection_id],
    references: [collections.id],
    relationName: 'source_collection',
  }),
  // This relation is now based on the logical document_id.
  // Note: This will relate to *all* versions of the document.
  // You will typically query against the `currentDocumentsView` to get the latest version.
  target_document: one(documentVersions, {
    fields: [relationStore.target_document_id],
    references: [documentVersions.document_id],
  }),
  target_collection: one(collections, {
    fields: [relationStore.target_collection_id],
    references: [collections.id],
  }),
}))

export const fileStoreRelations = relations(fileStore, ({ one }) => ({
  document: one(documentVersions, {
    fields: [fileStore.document_version_id],
    references: [documentVersions.id],
  }),
  collection: one(collections, {
    fields: [fileStore.collection_id],
    references: [collections.id],
  }),
}))

export const jsonStoreRelations = relations(jsonStore, ({ one }) => ({
  document: one(documentVersions, {
    fields: [jsonStore.document_version_id],
    references: [documentVersions.id],
  }),
  collection: one(collections, {
    fields: [jsonStore.collection_id],
    references: [collections.id],
  }),
}))
