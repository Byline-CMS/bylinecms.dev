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
  date,
  datetime,
  decimal,
  float,
  foreignKey,
  index,
  int,
  json,
  mysqlTable,
  mysqlView,
  primaryKey,
  text,
  time,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core'

import {
  createdAt,
  timestamps,
  uuidChar,
  varcharByteSorted,
  varcharCaseSensitive,
} from './common.js'

// Every foreign key below is declared with the table-level `foreignKey()`
// builder and an explicit, short `fk_<table>_<column>` name, rather than
// the column-level `.references()` shorthand the Postgres schema uses.
// This is a real dialect difference, not a style choice: MySQL enforces a
// hard 64-character identifier cap (`ER_TOO_LONG_IDENT`) on every
// constraint name, including auto-generated ones, whereas Postgres's
// 63-byte `NAMEDATALEN` limit is enforced by silent truncation. Byline's
// table/column names are long and descriptive enough (e.g.
// `byline_document_version_locales` + `document_version_id` +
// `byline_document_versions` + `id`) that drizzle-kit's auto-generated
// `<table>_<column>_<foreignTable>_<foreignColumn>_fk` name exceeds 64
// characters for roughly half the foreign keys in this schema — silently
// on Postgres, but as a hard migration failure on MySQL. Explicit naming
// throughout (not just for the offenders) keeps the convention uniform and
// keeps a future column rename from reintroducing the failure.

// Collections table
export const collections = mysqlTable('byline_collections', {
  id: uuidChar('id').primaryKey(),
  path: varchar('path', { length: 255 }).unique().notNull(),
  singular: text('singular').notNull(), // Singular label for the collection
  plural: text('plural').notNull(), // Plural label for the collection
  config: json('config').notNull(), // Store CollectionConfig
  // Monotonically-increasing schema version. Incremented by the startup
  // bootstrap whenever `schema_hash` changes (or to a value pinned
  // explicitly via `CollectionDefinition.version`).
  version: int('version').notNull().default(1),
  // SHA-256 fingerprint of the data-shape-relevant portion of the
  // collection's definition. Nullable in Phase 1 — populated on first
  // `ensureCollections()` run post-migration, tightens to NOT NULL when
  // the `collection_versions` history table lands.
  schema_hash: varchar('schema_hash', { length: 64 }),
  ...timestamps,
})

// Documents table
export const documents = mysqlTable(
  'byline_documents',
  {
    id: uuidChar('id').primaryKey(),
    collection_id: uuidChar('collection_id').notNull(),
    // Fractional-index sort key for collections with `orderable: true` in
    // their admin config. Null on collections that haven't opted in, and on
    // pre-existing rows in newly-`orderable` collections (sort NULLS LAST).
    // Admin metadata — never per-version, never EAV; updated by the reorder
    // server fn without bumping documentVersions.
    //
    // Uses `varcharByteSorted` (`ascii_bin`) so DB ordering matches JS string
    // comparison — the fractional-index algorithm requires this. See
    // `varcharByteSorted` in `./common.ts` and docs/04-collections/index.md (Orderable collections).
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
    foreignKey({
      name: 'fk_documents_collection_id',
      columns: [table.collection_id],
      foreignColumns: [collections.id],
    }).onDelete('cascade'),
    index('idx_documents_collection').on(table.collection_id),
    index('idx_documents_collection_order').on(table.collection_id, table.order_key),
  ]
)

// Document versions table
export const documentVersions = mysqlTable(
  'byline_document_versions',
  {
    id: uuidChar('id').primaryKey(), // UUIDv7 versioning by default
    document_id: uuidChar('document_id').notNull(),
    collection_id: uuidChar('collection_id').notNull(),
    // Collection schema version this row was authored against. Used by
    // future in-memory migration code to resolve historical document
    // shapes. Phase 1 records the number; no composite FK yet — that
    // anchors in Phase 2 alongside the history table.
    collection_version: int('collection_version').notNull(),
    doc: json('doc'), // optionally store the original document
    event_type: varchar('event_type', { length: 20 }).notNull().default('create'), // 'create', 'update', 'delete'
    status: varchar('status', { length: 50 }).default('draft'),
    is_deleted: boolean('is_deleted').default(false), // Tombstone for soft deletes
    ...timestamps,
    created_by: uuidChar('created_by'),
    change_summary: text('change_summary'),
  },
  (table) => [
    foreignKey({
      name: 'fk_document_versions_document_id',
      columns: [table.document_id],
      foreignColumns: [documents.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_document_versions_collection_id',
      columns: [table.collection_id],
      foreignColumns: [collections.id],
    }).onDelete('cascade'),
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
// place. See `docs/04-collections/05-document-paths.md` § "Path uniqueness".
//
// The `idx_document_paths_collection_locale_path` name below is
// load-bearing beyond this file: `classifyError` reports MySQL's
// duplicate-key error against the *index* name (unlike Postgres, which
// reports the constraint name), and
// `packages/core/src/services/document-lifecycle/internals.ts`
// substring-matches this exact string to detect a path collision. Do not
// rename it.
export const documentPaths = mysqlTable(
  'byline_document_paths',
  {
    document_id: uuidChar('document_id').notNull(),
    locale: varchar('locale', { length: 10 }).notNull(),
    collection_id: uuidChar('collection_id').notNull(),
    // `utf8mb4_bin`, not the database default — see `varcharCaseSensitive`
    // in `./common.ts` for why (case AND accent sensitivity, verified
    // against live Thai/Devanagari/Hebrew slugs, not just Latin parity).
    path: varcharCaseSensitive('path', { length: 255 }).notNull(),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      name: 'fk_document_paths_document_id',
      columns: [table.document_id],
      foreignColumns: [documents.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_document_paths_collection_id',
      columns: [table.collection_id],
      foreignColumns: [collections.id],
    }).onDelete('cascade'),
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
// deletes then re-inserts the set), never appended. See docs/07-internationalization/index.md.
export const documentAvailableLocales = mysqlTable(
  'byline_document_available_locales',
  {
    document_id: uuidChar('document_id').notNull(),
    locale: varchar('locale', { length: 10 }).notNull(),
    collection_id: uuidChar('collection_id').notNull(),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      name: 'fk_document_available_locales_document_id',
      columns: [table.document_id],
      foreignColumns: [documents.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_document_available_locales_collection_id',
      columns: [table.collection_id],
      foreignColumns: [collections.id],
    }).onDelete('cascade'),
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
// scanning the store_* tables. See docs/07-internationalization/index.md.
export const documentVersionLocales = mysqlTable(
  'byline_document_version_locales',
  {
    document_version_id: uuidChar('document_version_id').notNull(),
    locale: varchar('locale', { length: 10 }).notNull(),
  },
  (table) => [
    foreignKey({
      name: 'fk_document_version_locales_document_version_id',
      columns: [table.document_version_id],
      foreignColumns: [documentVersions.id],
    }).onDelete('cascade'),
    primaryKey({ columns: [table.document_version_id, table.locale] }),
  ]
)

// Document Tree — single-parent ordered adjacency. See docs/04-collections/04-document-trees.md.
//
// A document-grain, unversioned hierarchy primitive for `tree: true`
// collections (self-referential, single collection). Rows reference the logical
// `document_id`, not the version `id`. Unlike most edge tables the FKs are
// load-bearing here:
//   - child  → cascade : when the document is deleted, its membership row
//                        disappears (the node leaves the tree).
//   - parent → set null: when a parent document is deleted, its children's
//                        parent pointer clears — they promote to root.
export const documentRelationships = mysqlTable(
  'byline_document_relationships',
  {
    child_document_id: uuidChar('child_document_id').notNull(),
    // Nullable = root node. `set null` promotes orphans to root on parent delete.
    parent_document_id: uuidChar('parent_document_id'),
    // Per-parent sibling order (each parent is its own keyspace). ascii_bin
    // so DB ordering matches the JS fractional-index algorithm, exactly like
    // `byline_documents.order_key`.
    order_key: varcharByteSorted('order_key', { length: 128 }).notNull(),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      name: 'fk_document_relationships_child_document_id',
      columns: [table.child_document_id],
      foreignColumns: [documents.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_document_relationships_parent_document_id',
      columns: [table.parent_document_id],
      foreignColumns: [documents.id],
    }).onDelete('set null'),
    // Single-parent invariant: each document appears in at most one row.
    unique('uq_document_relationships_child').on(table.child_document_id),
    // Per-parent sibling read, in order — drives the authoring tree and the
    // read-side flatten.
    index('idx_document_relationships_parent_order').on(table.parent_document_id, table.order_key),
  ]
)

// Current Documents View — latest version of each logical document via
// `ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY id DESC)`.
//
// MySQL forbade subqueries in a view's FROM clause until 8.0.14 — the same
// release that added LATERAL — which is the real reason this adapter's
// engine floor is 8.0.14 (see `src/lib/boot-check.ts`). Ported here with
// the same CTE-backed shape as the Postgres view.
//
// `path` is intentionally NOT projected here. Path resolution is locale-
// aware and lives in the storage adapter's read functions, which join
// `byline_document_paths` with the requested locale + default-locale
// fallback. See docs/04-collections/05-document-paths.md.
export const currentDocumentsView = mysqlView('byline_current_documents').as((qb) => {
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
      // See docs/07-internationalization/index.md.
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
export const currentPublishedDocumentsView = mysqlView('byline_current_published_documents').as(
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
  id: uuidChar('id').primaryKey(),
  document_version_id: uuidChar('document_version_id').notNull(), // References the version ID
  collection_id: uuidChar('collection_id').notNull(), // For cross-collection queries
  // Kept at 500, matching the Postgres schema's `field_path` bound exactly
  // (`packages/db-postgres/src/database/schema/index.ts`) — an earlier
  // version of this file widened it to 512, but that was a mistake: it
  // both broke parity with pg for no reason and left `parent_path` (below,
  // a prefix of `field_path`) too narrow to hold a maximal `field_path`
  // value, which would raise `ER_DATA_TOO_LONG` under strict mode on
  // MySQL — a state unreachable on the pg adapter. The store tables'
  // tightest unique key — (document_version_id, field_path, locale) — is
  // 2076 bytes under InnoDB's 3072-byte DYNAMIC index-key cap: 36
  // (char(36) ascii) + 2000 (varchar(500) utf8mb4) + 40 (varchar(10)
  // utf8mb4). `idx_text_path_value` (field_path + a 191-char prefix of
  // `value`) is the tightest *non-unique* index on this table at 2764
  // bytes. See `schema-pins.test.node.ts`, which pins both.
  field_path: varchar('field_path', { length: 500 }).notNull(),
  field_name: varchar('field_name', { length: 255 }).notNull(),
  locale: varchar('locale', { length: 10 }).notNull().default('default'),
  parent_path: varchar('parent_path', { length: 500 }),
  ...timestamps,
}

// 1. TEXT FIELDS TABLE
export const textStore = mysqlTable(
  'byline_store_text',
  {
    ...baseStoreColumns,

    value: text('value').notNull(),
    word_count: int('word_count'), // Pre-computed for analytics
  },
  (table) => [
    foreignKey({
      name: 'fk_store_text_document_version_id',
      columns: [table.document_version_id],
      foreignColumns: [documentVersions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_store_text_collection_id',
      columns: [table.collection_id],
      foreignColumns: [collections.id],
    }).onDelete('cascade'),
    // Optimized indexes for text operations. MySQL requires an explicit
    // key-length prefix to index a TEXT column (error 1170 otherwise) —
    // 191 is the conventional MySQL prefix length (the largest that stays
    // under the historical 767-byte REDUNDANT/COMPACT index-key limit at
    // 4 bytes/char for utf8mb4: 767 / 4 ≈ 191), kept here even though this
    // schema's DYNAMIC row format has more headroom, for portability.
    index('idx_text_value').on(sql`${table.value}(191)`),
    // Dropped: Postgres's GIN index over `to_tsvector('english', value)`
    // has no MySQL equivalent through this schema layer (MySQL's own
    // full-text index type is not exposed by drizzle-kit's mysql-core index
    // builder, which only supports 'btree' | 'hash'). Not load-bearing —
    // no query code references this index name — and Byline's actual
    // full-text search is a separate, pluggable `SearchProvider` seam
    // (`@byline/core`), not built on this table's indexes. See
    // docs/05-reading-and-delivery/07-search.md.
    index('idx_text_locale_value').on(table.locale, sql`${table.value}(191)`),
    index('idx_text_path_value').on(table.field_path, sql`${table.value}(191)`),
    // Unique constraints for unique fields
    unique('unique_text_field').on(table.document_version_id, table.field_path, table.locale),
  ]
)

// 2. NUMERIC FIELDS TABLE
export const numericStore = mysqlTable(
  'byline_store_numeric',
  {
    ...baseStoreColumns,

    // Store the original number type for reconstruction
    number_type: varchar('number_type', { length: 20 }).notNull(), // 'integer', 'decimal', 'float'

    value_integer: int('value_integer'),
    value_decimal: decimal('value_decimal', { precision: 10, scale: 2 }),
    // Postgres `real` (single-precision float) → MySQL `FLOAT` (also
    // single-precision). MySQL's `REAL` is a configurable alias for
    // `DOUBLE` unless the server runs with `REAL_AS_FLOAT`, so `float()` is
    // the unambiguous match rather than the `real()` name.
    value_float: float('value_float'),
  },
  (table) => [
    foreignKey({
      name: 'fk_store_numeric_document_version_id',
      columns: [table.document_version_id],
      foreignColumns: [documentVersions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_store_numeric_collection_id',
      columns: [table.collection_id],
      foreignColumns: [collections.id],
    }).onDelete('cascade'),
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
export const booleanStore = mysqlTable(
  'byline_store_boolean',
  {
    ...baseStoreColumns,

    value: boolean('value').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'fk_store_boolean_document_version_id',
      columns: [table.document_version_id],
      foreignColumns: [documentVersions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_store_boolean_collection_id',
      columns: [table.collection_id],
      foreignColumns: [collections.id],
    }).onDelete('cascade'),
    // Simple but effective indexes for boolean queries
    index('idx_boolean_value').on(table.value),
    index('idx_boolean_path_value').on(table.field_path, table.value),
    index('idx_boolean_collection_value').on(table.collection_id, table.field_path, table.value),
    unique('unique_boolean_field').on(table.document_version_id, table.field_path, table.locale),
  ]
)

// 4. DATE/TIME FIELDS TABLE
export const datetimeStore = mysqlTable(
  'byline_store_datetime',
  {
    ...baseStoreColumns,

    // Store the original date type for reconstruction
    date_type: varchar('date_type', { length: 20 }).notNull(), // 'date', 'time', 'timestamptz'

    value_date: date('value_date'),
    // fsp 3, matching the fsp discipline used everywhere else in this
    // schema (spec §2). Without an explicit fsp, MySQL's `TIME` defaults
    // to whole-second precision, silently truncating a fractional time
    // value that round-trips fine on Postgres — whose `time` column (also
    // declared with no explicit precision) defaults to microsecond
    // precision instead. `time` is a real Byline field type
    // (`packages/core/src/storage/field-store-map.ts`), so this isn't a
    // hypothetical: a document with a fractional-second time value would
    // read back truncated after a write, MySQL-only.
    value_time: time('value_time', { fsp: 3 }),
    // Postgres `timestamptz` → `datetime(3)` (spec §2). UTC by convention —
    // see `common.ts`'s `auditTimestamp` doc comment.
    value_timestamp_tz: datetime('value_timestamp_tz', { fsp: 3 }),
  },
  (table) => [
    foreignKey({
      name: 'fk_store_datetime_document_version_id',
      columns: [table.document_version_id],
      foreignColumns: [documentVersions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_store_datetime_collection_id',
      columns: [table.collection_id],
      foreignColumns: [collections.id],
    }).onDelete('cascade'),
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
export const relationStore = mysqlTable(
  'byline_store_relation',
  {
    ...baseStoreColumns,

    target_document_id: uuidChar('target_document_id').notNull(),

    target_collection_id: uuidChar('target_collection_id').notNull(),

    // Relationship metadata
    relationship_type: varchar('relationship_type', { length: 50 }).default('reference'), // 'reference', 'embed', 'weak'
    cascade_delete: boolean('cascade_delete').default(false),
  },
  (table) => [
    foreignKey({
      name: 'fk_store_relation_document_version_id',
      columns: [table.document_version_id],
      foreignColumns: [documentVersions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_store_relation_collection_id',
      columns: [table.collection_id],
      foreignColumns: [collections.id],
    }).onDelete('cascade'),
    // No onDelete — matches the Postgres schema's `.references(() =>
    // documents.id)` / `.references(() => collections.id)` without an
    // onDelete option, which defaults to NO ACTION on both dialects.
    foreignKey({
      name: 'fk_store_relation_target_document_id',
      columns: [table.target_document_id],
      foreignColumns: [documents.id],
    }),
    foreignKey({
      name: 'fk_store_relation_target_collection_id',
      columns: [table.target_collection_id],
      foreignColumns: [collections.id],
    }),
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
export const metaStore = mysqlTable(
  'byline_store_meta',
  {
    id: uuidChar('id').primaryKey(),
    document_version_id: uuidChar('document_version_id').notNull(),
    collection_id: uuidChar('collection_id').notNull(),

    // Node classification and linkage back into the reconstructed tree.
    // Bounded (Postgres uses unbounded `text`) because MySQL cannot index
    // an unbounded TEXT/BLOB column without an explicit key-length prefix,
    // and both columns below participate in `unique_meta_node`. 50/512
    // keep the tightest key on this table — 36 (id, ascii) + 200 (type,
    // utf8mb4) + 2048 (path, utf8mb4) = 2284 bytes — comfortably under the
    // 3072-byte InnoDB cap; see `schema-pins.test.node.ts`.
    type: varchar('type', { length: 50 }).notNull(),
    path: varchar('path', { length: 512 }).notNull(),

    // Durable identifier for this item within a document version. This is the
    // ID exposed to the dashboard/API for blocks, array items, etc.
    item_id: varchar('item_id', { length: 255 }).notNull(),

    // Optional opaque metadata payload for this node. Common attributes like
    // label, icon, collapsed state, etc. can be stored here.
    meta: json('meta'),

    ...timestamps,
  },
  (table) => [
    foreignKey({
      name: 'fk_store_meta_document_version_id',
      columns: [table.document_version_id],
      foreignColumns: [documentVersions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_store_meta_collection_id',
      columns: [table.collection_id],
      foreignColumns: [collections.id],
    }).onDelete('cascade'),
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
export const fileStore = mysqlTable(
  'byline_store_file',
  {
    ...baseStoreColumns,

    // File identity
    file_id: uuidChar('file_id').notNull(), // Reference to file storage system
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
    image_width: int('image_width'),
    image_height: int('image_height'),
    image_format: varchar('image_format', { length: 20 }),

    // File processing status
    processing_status: varchar('processing_status', { length: 20 }).default('pending'), // 'pending', 'processing', 'completed', 'failed'
    thumbnail_generated: boolean('thumbnail_generated').default(false),

    // Image variants (Sharp-generated derivatives). Persisted as JSON so
    // the read path can return a `<picture>` / `srcset`-ready array
    // without a sidecar table. Shape: FileStoreVariant[] —
    // { name, storage_path, storage_url?, width?, height?, format? }.
    variants: json('variants'),
  },
  (table) => [
    foreignKey({
      name: 'fk_store_file_document_version_id',
      columns: [table.document_version_id],
      foreignColumns: [documentVersions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_store_file_collection_id',
      columns: [table.collection_id],
      foreignColumns: [collections.id],
    }).onDelete('cascade'),
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
export const jsonStore = mysqlTable(
  'byline_store_json',
  {
    ...baseStoreColumns,

    value: json('value').notNull(),
    // JSON metadata for optimization
    json_schema: varchar('json_schema', { length: 100 }), // Schema identifier for validation
    // Postgres `text[]` (array of top-level keys) → MySQL `json`, storing a
    // JSON array of strings. MySQL has no native array column type.
    object_keys: json('object_keys'),
  },
  (table) => [
    foreignKey({
      name: 'fk_store_json_document_version_id',
      columns: [table.document_version_id],
      foreignColumns: [documentVersions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_store_json_collection_id',
      columns: [table.collection_id],
      foreignColumns: [collections.id],
    }).onDelete('cascade'),
    // Dropped: `idx_json_value_gin` (Postgres GIN over the whole `value`
    // jsonb blob, for containment queries) and `idx_json_keys` (GIN over
    // the `object_keys` array) have no MySQL equivalent through this schema
    // layer — MySQL cannot index a JSON column directly; doing so requires
    // a generated/virtual column over a specific JSON path expression,
    // which is a different (narrower) indexing strategy than "index the
    // whole document," not a straight port. Neither index name is
    // referenced by any query code today.
    index('idx_json_schema').on(table.json_schema),

    unique('unique_json_field').on(table.document_version_id, table.field_path, table.locale),
  ]
)

// ---------------------------------------------------------------------------
// Counter groups registry
// ---------------------------------------------------------------------------
//
// One row per counter `group` discovered in collection field definitions.
// On Postgres the actual ID allocator is a SEQUENCE object (named in
// `sequence_name`), reconciled at boot by `IDbAdapter.ensureCounterGroup`.
// MySQL has no native user-defined SEQUENCE object (unlike Postgres, or
// MariaDB's own extension) — the concrete allocation mechanism this column
// backs on MySQL is a Task 11 decision, not this schema-only task's. The
// registry table itself only records that the group exists and which
// allocator object backs it; it is not used in the hot allocation path.
//
// Why a separate table rather than reading allocator objects from
// `information_schema`: the mapping from `group_name` → allocator identity
// belongs in the application's schema, not in MySQL metadata, so backups
// and adapter logic have a stable name to anchor against.
//
// `group_name` is bounded (Postgres uses unbounded `text`) because it is
// this table's primary key, and MySQL cannot index — including as a
// PRIMARY KEY — an unbounded TEXT/BLOB column without an explicit
// key-length prefix. 255 matches `byline_collections.path`'s bound, the
// closest sibling "short identifier" column in this schema.
export const counterGroups = mysqlTable('byline_counter_groups', {
  group_name: varchar('group_name', { length: 255 }).primaryKey(),
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
  parent: one(documents, {
    fields: [documentRelationships.parent_document_id],
    references: [documents.id],
    relationName: 'tree_parent',
  }),
  child: one(documents, {
    fields: [documentRelationships.child_document_id],
    references: [documents.id],
    relationName: 'tree_child',
  }),
}))

// Document-tree edges on the logical document. The tree read path itself is a
// recursive CTE (see docs/04-collections/04-document-trees.md), not the Drizzle query builder —
// these relations exist for completeness / ad-hoc joins.
export const documentTreeRelations = relations(documents, ({ many }) => ({
  // The membership edge where this document is the child — its placement in the
  // tree. 0..1 by the unique(child_document_id) constraint; modelled as `many`
  // per Drizzle's inverse-side convention (the FK lives on the edge table).
  tree_parent_edge: many(documentRelationships, { relationName: 'tree_child' }),
  // Edges where this document is the parent — its ordered children.
  tree_child_edges: many(documentRelationships, { relationName: 'tree_parent' }),
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
// Audit log — byline_audit_log
// ---------------------------------------------------------------------------

// Document-grain audit log. Records the changes the immutable version stream
// does NOT capture an actor for: non-versioned system-field writes (path,
// availableLocales), in-place status transitions, and deletions — plus, later,
// admin-module events. One generic table (nullable `document_id`, namespaced
// `action`) so the system-wide activity report and future admin-realm auditing
// fit without a second migration. Append-only and deliberately **FK-free**: an
// audit row is an immutable historical fact that must outlive the document,
// collection, or actor it references — a `document.deleted` row cannot be
// allowed to cascade-delete itself. See docs/06-auth-and-security/02-auditability.md — Workstream 2.
export const auditLog = mysqlTable(
  'byline_audit_log',
  {
    id: uuidChar('id').primaryKey(), // UUIDv7 — time-ordered, so id ordering ≈ time ordering
    document_id: uuidChar('document_id'), // NULL for admin-realm (non-document) events; no FK
    collection_id: uuidChar('collection_id'), // no FK — outlives the collection
    actor_id: uuidChar('actor_id'), // NULL = system / internal tooling / non-UUID synthetic actor
    actor_realm: varchar('actor_realm', { length: 16 }).notNull(), // 'admin' | 'user' | 'system'
    action: varchar('action', { length: 64 }).notNull(), // namespaced, e.g. 'document.path.changed'
    field: varchar('field', { length: 128 }), // the changed field where meaningful (e.g. 'path'), else NULL
    before: json('before'),
    after: json('after'),
    occurred_at: datetime('occurred_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    // Per-document history, time-ordered (id is UUIDv7).
    index('idx_audit_log_document_id').on(table.document_id, table.id),
    // Per-actor activity — the system-wide report's actor filter.
    index('idx_audit_log_actor_id').on(table.actor_id, table.id),
    // Action-type filter for the activity report.
    index('idx_audit_log_action').on(table.action, table.id),
  ]
)

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
  adminUserPreferences,
  adminUsers,
  adminUsersRelations,
} from './auth.js'
