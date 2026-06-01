/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { eq, relations, sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  customType,
  date,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  pgView,
  primaryKey,
  real,
  text,
  time,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

import { createdAt, timestamps } from './common.js'

/**
 * `varchar(...)` with explicit byte-wise (C) collation.
 *
 * Used for `byline_documents.order_key` so the column sorts the same way
 * JavaScript string comparison does. The fractional-index algorithm in
 * `@byline/core` (`generateKeyBetween`, `generateNKeysBetween`) is designed
 * against byte-wise ordering; the database default collation (e.g.
 * `en_US.utf8` on most modern installs) is locale-aware and disagrees with
 * JS on cases like `'Zz' vs 'a0'` — which causes a refetch after a drag-
 * reorder to "snap" the moved row back to its original position.
 *
 * Captured here (rather than only in a hand-written migration) so future
 * regenerations from this schema reproduce the COLLATE clause cleanly.
 * See migration `0003_order_key_byte_collation.sql` and `docs/COLLECTIONS.md` (Orderable collections).
 */
const varcharByteSorted = customType<{
  data: string
  driverData: string
  config: { length: number }
}>({
  dataType(config) {
    const len = config?.length ?? 255
    return `varchar(${len}) COLLATE "C"`
  },
})

// Collections table
export const collections = pgTable('byline_collections', {
  id: uuid('id').primaryKey(),
  path: varchar('path', { length: 255 }).unique().notNull(),
  singular: text('singular').notNull(), // Singular label for the collection
  plural: text('plural').notNull(), // Plural label for the collection
  config: jsonb('config').notNull(), // Store CollectionConfig
  // Monotonically-increasing schema version. Incremented by the startup
  // bootstrap whenever `schema_hash` changes (or to a value pinned
  // explicitly via `CollectionDefinition.version`).
  version: integer('version').notNull().default(1),
  // SHA-256 fingerprint of the data-shape-relevant portion of the
  // collection's definition. Nullable in Phase 1 — populated on first
  // `ensureCollections()` run post-migration, tightens to NOT NULL when
  // the `collection_versions` history table lands.
  schema_hash: varchar('schema_hash', { length: 64 }),
  ...timestamps,
})

// Documents table
export const documents = pgTable(
  'byline_documents',
  {
    id: uuid('id').primaryKey(),
    collection_id: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    // Fractional-index sort key for collections with `orderable: true` in
    // their admin config. Null on collections that haven't opted in, and on
    // pre-existing rows in newly-`orderable` collections (sort NULLS LAST).
    // Admin metadata — never per-version, never EAV; updated by the reorder
    // server fn without bumping documentVersions.
    //
    // Uses `varcharByteSorted` (COLLATE "C") so DB ordering matches JS string
    // comparison — the fractional-index algorithm requires this. See
    // `varcharByteSorted` above and docs/COLLECTIONS.md (Orderable collections).
    order_key: varcharByteSorted('order_key', { length: 128 }),
    // The content locale this document was first authored in — its per-document
    // data anchor. Set once at creation (= the global default content locale at
    // that moment) and immutable in normal operation; changed only by the
    // deliberate re-anchor operation. Re-bases the fallback floor, the path
    // locale, and the completeness ledger off the mutable global config onto
    // the document's own truth, so switching `i18n.content.defaultLocale` no
    // longer silently re-interprets existing data. Backfilled by
    // `backfillSourceLocales()` (boot-auto via initBylineCore).
    //
    source_locale: varchar('source_locale', { length: 10 }).notNull(),
    ...timestamps,
  },
  (table) => [
    index('idx_documents_collection').on(table.collection_id),
    index('idx_documents_collection_order').on(table.collection_id, table.order_key),
  ]
)

// Document versions table
export const documentVersions = pgTable(
  'byline_document_versions',
  {
    id: uuid('id').primaryKey(), // UUIDv7 versioning by default
    document_id: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    collection_id: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    // Collection schema version this row was authored against. Used by
    // future in-memory migration code to resolve historical document
    // shapes. Phase 1 records the number; no composite FK yet — that
    // anchors in Phase 2 alongside the history table.
    collection_version: integer('collection_version').notNull(),
    doc: jsonb('doc'), // optionally store the original document
    event_type: varchar('event_type', { length: 20 }).notNull().default('create'), // 'create', 'update', 'delete'
    status: varchar('status', { length: 50 }).default('draft'),
    is_deleted: boolean('is_deleted').default(false), // Tombstone for soft deletes
    ...timestamps,
    created_by: uuid('created_by'),
    change_summary: text('change_summary'),
  },
  (table) => [
    // Index for finding all versions of a logical document
    index('idx_documents_document_id').on(table.document_id),
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
  ]
)

// Document paths — one row per (logical document, content locale).
// Promotes `path` out of the version row so per-collection uniqueness can
// be enforced at the DB layer without colliding with the sticky
// carry-forward of path across versions. Phase 1 only ever writes the
// installation's default content locale; per-locale UI is a future phase
// that adds rows for additional locales without reshaping the schema.
// History is intentionally not preserved here — path rows are updated in
// place. See `docs/DOCUMENT-PATHS.md` § "Path uniqueness".
export const documentPaths = pgTable(
  'byline_document_paths',
  {
    document_id: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    locale: varchar('locale', { length: 10 }).notNull(),
    collection_id: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    path: varchar('path', { length: 255 }).notNull(),
    ...timestamps,
  },
  (table) => [
    // One path per (logical document, locale).
    unique('unique_document_paths_document_locale').on(table.document_id, table.locale),
    // Per-collection per-locale path uniqueness. Column order matches the
    // resolution lookup pattern: WHERE collection_id = ? AND locale = ? AND path = ?.
    unique('idx_document_paths_collection_locale_path').on(
      table.collection_id,
      table.locale,
      table.path
    ),
    // Reverse lookup by document.
    index('idx_document_paths_document_id').on(table.document_id),
  ]
)

// Document → advertised content locales. One row per (logical document,
// advertised locale) — the editorial "advertise these locales" set an editor
// curates per document. The deliberate counterpart to the derived,
// version-grained `byline_document_version_locales` ledger: this is intent
// ("I want these advertised"), the ledger is fact ("this version is complete
// in these"). Document-grain and sticky across versions — editorial intent
// carries forward across edits and survives restore. Surfaced on reads as
// `availableLocales`; the public advertised set is the intersection with the
// ledger's `_availableVersionLocales`. Replaced wholesale on write (the lifecycle
// deletes then re-inserts the set), never appended. See docs/I18N.md.
export const documentAvailableLocales = pgTable(
  'byline_document_available_locales',
  {
    document_id: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    locale: varchar('locale', { length: 10 }).notNull(),
    collection_id: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (table) => [
    // One row per (logical document, advertised locale).
    primaryKey({ columns: [table.document_id, table.locale] }),
    // Reverse lookup by document for the read projection.
    index('idx_document_available_locales_document_id').on(table.document_id),
  ]
)

// Document version → available content locales. One row per (version, locale)
// for every locale the version's content is *complete* in — path-coverage
// against the default content locale: a locale is recorded only when it covers
// every localized field path the default locale has. A version with no
// localized content at all gets a single `'all'` sentinel row (it renders
// identically in any locale). Computed status-blind at write time and frozen
// on the immutable version, so restore / point-in-time reads stay consistent.
// Drives `localeFallback: 'strict'` reads via an indexed EXISTS gate without
// scanning the store_* tables. See docs/I18N.md.
export const documentVersionLocales = pgTable(
  'byline_document_version_locales',
  {
    document_version_id: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    locale: varchar('locale', { length: 10 }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.document_version_id, table.locale] })]
)

// Document Relationships (Parent/Child) - Many-to-Many
export const documentRelationships = pgTable(
  'byline_document_relationships',
  {
    // Note: These reference the logical `document_id`, not the version `id`.
    // Foreign key constraints are not used; integrity is handled at the application layer.
    parent_document_id: uuid('parent_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    child_document_id: uuid('child_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    ...createdAt,
  },
  (table) => [
    // Composite primary key to ensure a child is only parented once by the same parent.
    unique().on(table.parent_document_id, table.child_document_id),
    // Indexes for efficient lookups of children and parents.
    index('idx_document_relationships_parent').on(table.parent_document_id),
    index('idx_document_relationships_child').on(table.child_document_id),
  ]
)

// Current Documents View — latest version of each logical document via
// `ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY id DESC)`.
// `selectDistinct` is not an option here: it distincts on the whole row,
// not on `document_id`.
//
// `path` is intentionally NOT projected here. Path resolution is locale-
// aware and lives in the storage adapter's read functions, which join
// `byline_document_paths` with the requested locale + default-locale
// fallback. See docs/DOCUMENT-PATHS.md.
export const currentDocumentsView = pgView('byline_current_documents').as((qb) => {
  const sq = qb.$with('sq').as(
    qb
      .select({
        id: documentVersions.id,
        document_id: documentVersions.document_id,
        collection_id: documentVersions.collection_id,
        collection_version: documentVersions.collection_version,
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
  // `order_key` is sourced from `byline_documents` (the logical-document
  // row, not the version row). Joining it through the view keeps
  // `d.order_key` addressable in findDocuments' ORDER BY without an
  // ad-hoc join per query. Always nullable; null sorts last for
  // collections that haven't opted in to `orderable: true`.
  return qb
    .with(sq)
    .select({
      id: sq.id,
      document_id: sq.document_id,
      collection_id: sq.collection_id,
      collection_version: sq.collection_version,
      event_type: sq.event_type,
      status: sq.status,
      is_deleted: sq.is_deleted,
      created_at: sq.created_at,
      updated_at: sq.updated_at,
      created_by: sq.created_by,
      change_summary: sq.change_summary,
      order_key: documents.order_key,
      // The document's content-locale anchor, projected here so locale-aware
      // read paths (`buildLocaleChain` / `pathProjection` / field-fallback)
      // re-base onto the per-document source rather than the mutable global
      // default — a primary-key join, already present for `order_key`.
      // See docs/I18N.md.
      source_locale: documents.source_locale,
    })
    .from(sq)
    .innerJoin(documents, eq(documents.id, sq.document_id))
    .where(eq(sq.rn, 1))
})

// Current Published Documents View - gets the latest version of each logical
// document whose status is 'published', regardless of whether a newer draft
// version exists. Used by `readMode: 'published'` on reads so public
// consumers keep seeing the last published content while editors work on
// drafts. Row-wise shape is identical to `current_documents`.
export const currentPublishedDocumentsView = pgView('byline_current_published_documents').as(
  (qb) => {
    const sq = qb.$with('sq').as(
      qb
        .select({
          id: documentVersions.id,
          document_id: documentVersions.document_id,
          collection_id: documentVersions.collection_id,
          collection_version: documentVersions.collection_version,
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
        .where(
          sql`${documentVersions.is_deleted} = false AND ${documentVersions.status} = 'published'`
        )
    )
    return qb
      .with(sq)
      .select({
        id: sq.id,
        document_id: sq.document_id,
        collection_id: sq.collection_id,
        collection_version: sq.collection_version,
        event_type: sq.event_type,
        status: sq.status,
        is_deleted: sq.is_deleted,
        created_at: sq.created_at,
        updated_at: sq.updated_at,
        created_by: sq.created_by,
        change_summary: sq.change_summary,
        order_key: documents.order_key,
        // See `currentDocumentsView` — the per-document content-locale anchor,
        // carried for locale-aware reads. PK join, already present.
        source_locale: documents.source_locale,
      })
      .from(sq)
      .innerJoin(documents, eq(documents.id, sq.document_id))
      .where(eq(sq.rn, 1))
  }
)

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
  ...timestamps,
}

// 1. TEXT FIELDS TABLE
export const textStore = pgTable(
  'byline_store_text',
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
  'byline_store_numeric',
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
  'byline_store_boolean',
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
  'byline_store_datetime',
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
  'byline_store_relation',
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
  'byline_store_meta',
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

    ...timestamps,
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
  'byline_store_file',
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

    // Image variants (Sharp-generated derivatives). Persisted as jsonb so
    // the read path can return a `<picture>` / `srcset`-ready array
    // without a sidecar table. Shape: FileStoreVariant[] —
    // { name, storage_path, storage_url?, width?, height?, format? }.
    variants: jsonb('variants'),
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
  'byline_store_json',
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

// ---------------------------------------------------------------------------
// Counter groups registry
// ---------------------------------------------------------------------------
//
// One row per counter `group` discovered in collection field definitions.
// The actual ID allocator is a Postgres SEQUENCE (named in `sequence_name`),
// reconciled at boot by `IDbAdapter.ensureCounterGroup`. The registry table
// itself only records that the group exists and which sequence backs it —
// it is not used in the hot allocation path (`nextval()` operates on the
// sequence object directly).
//
// Why a separate table rather than reading sequences from
// `information_schema`: the mapping from `group_name` → `sequence_name`
// belongs in the application's schema, not in PG metadata, so backups and
// adapter logic have a stable name to anchor against.
export const counterGroups = pgTable('byline_counter_groups', {
  group_name: text('group_name').primaryKey(),
  sequence_name: text('sequence_name').notNull(),
  ...createdAt,
})

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

// ---------------------------------------------------------------------------
// Auth schema — byline_admin_users, byline_admin_roles, etc.
// See ./auth.ts for definitions and rationale.
// ---------------------------------------------------------------------------

export {
  adminPermissions,
  adminPermissionsRelations,
  adminRefreshTokens,
  adminRefreshTokensRelations,
  adminRoleAdminUser,
  adminRoleAdminUserRelations,
  adminRoles,
  adminRolesRelations,
  adminUsers,
  adminUsersRelations,
} from './auth.js'
