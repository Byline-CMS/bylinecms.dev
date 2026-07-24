/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * The dialect-independent column manifest for the EAV store tables.
 *
 * Every adapter's UNION ALL over its `store_*` tables projects into the same
 * unified row shape (see `UnifiedFieldValue`). Instead of each adapter
 * hand-maintaining its own list of columns, adapters generate their SELECT
 * lists from this single manifest — adding a column or a new store table is
 * a one-line change here rather than N hand-synchronized SQL fragments.
 *
 * This module is pure data: no SQL, no drizzle-orm, no pg. Each adapter owns
 * its own SQL generation (e.g. `@byline/db-postgres`'s `storeSelectList()` +
 * `pgNullCast()`) consuming this manifest.
 */

import type { StoreType } from './field-store-map.js'

/**
 * Each entry describes one column in the unified UNION ALL output.
 *
 * - `name`:     The output column alias (matches UnifiedFieldValue / FlattenedFieldValue).
 * - `nullCast`: The abstract SQL type name used when a store table does NOT
 *               provide this column (e.g. `'boolean'`, `'uuid'`, `'text'`).
 *               Only the first SELECT in a UNION ALL strictly needs casts,
 *               but including them everywhere is harmless and makes each
 *               fragment self-describing. Each adapter maps this abstract
 *               name to its own dialect cast — the Postgres adapter's
 *               `pgNullCast()` renders it as `NULL::<cast>`.
 * - `sources`:  A map from store type key → the source column name that
 *               produces this column's value from that table. If a store
 *               type is absent, the column is emitted as a typed NULL.
 */
export interface ColumnDef {
  name: string
  nullCast: string
  sources?: Partial<Record<StoreType, string>>
}

/** Store table names, keyed by StoreType. Shared naming convention across adapters. */
export const storeTableNames: Record<StoreType, string> = {
  text: 'byline_store_text',
  numeric: 'byline_store_numeric',
  boolean: 'byline_store_boolean',
  datetime: 'byline_store_datetime',
  json: 'byline_store_json',
  relation: 'byline_store_relation',
  file: 'byline_store_file',
}

/**
 * Canonical column order for the unified UNION ALL output.
 *
 * The first 7 columns are shared across all store tables (base columns).
 * The remaining columns are type-specific — each one declares which store
 * table(s) provide it and what source column to read.
 */
export const storeColumnManifest: ColumnDef[] = [
  // -- Base columns (provided by every store table) -------------------------
  { name: 'id', nullCast: 'uuid' },
  { name: 'document_version_id', nullCast: 'uuid' },
  { name: 'collection_id', nullCast: 'uuid' },
  // field_type is handled specially — see each adapter's SELECT-list builder.
  { name: 'field_path', nullCast: 'varchar' },
  { name: 'field_name', nullCast: 'varchar' },
  { name: 'locale', nullCast: 'varchar' },
  { name: 'parent_path', nullCast: 'varchar' },

  // -- Text -----------------------------------------------------------------
  {
    name: 'text_value',
    nullCast: 'text',
    sources: { text: 'value' },
  },

  // -- Boolean --------------------------------------------------------------
  {
    name: 'boolean_value',
    nullCast: 'boolean',
    sources: { boolean: 'value' },
  },

  // -- JSON -----------------------------------------------------------------
  {
    name: 'json_value',
    nullCast: 'jsonb',
    sources: { json: 'value' },
  },

  // -- DateTime -------------------------------------------------------------
  {
    name: 'date_type',
    nullCast: 'varchar',
    sources: { datetime: 'date_type' },
  },
  {
    name: 'value_date',
    nullCast: 'date',
    sources: { datetime: 'value_date' },
  },
  {
    name: 'value_time',
    nullCast: 'time',
    sources: { datetime: 'value_time' },
  },
  {
    name: 'value_timestamp_tz',
    nullCast: 'timestamp',
    sources: { datetime: 'value_timestamp_tz' },
  },

  // -- File -----------------------------------------------------------------
  {
    name: 'file_id',
    nullCast: 'uuid',
    sources: { file: 'file_id' },
  },
  {
    name: 'filename',
    nullCast: 'varchar',
    sources: { file: 'filename' },
  },
  {
    name: 'original_filename',
    nullCast: 'varchar',
    sources: { file: 'original_filename' },
  },
  {
    name: 'mime_type',
    nullCast: 'varchar',
    sources: { file: 'mime_type' },
  },
  {
    name: 'file_size',
    nullCast: 'bigint',
    sources: { file: 'file_size' },
  },
  {
    name: 'storage_provider',
    nullCast: 'varchar',
    sources: { file: 'storage_provider' },
  },
  {
    name: 'storage_path',
    nullCast: 'text',
    sources: { file: 'storage_path' },
  },
  {
    name: 'storage_url',
    nullCast: 'text',
    sources: { file: 'storage_url' },
  },
  {
    name: 'file_hash',
    nullCast: 'varchar',
    sources: { file: 'file_hash' },
  },
  {
    name: 'image_width',
    nullCast: 'integer',
    sources: { file: 'image_width' },
  },
  {
    name: 'image_height',
    nullCast: 'integer',
    sources: { file: 'image_height' },
  },
  {
    name: 'image_format',
    nullCast: 'varchar',
    sources: { file: 'image_format' },
  },
  {
    name: 'processing_status',
    nullCast: 'varchar',
    sources: { file: 'processing_status' },
  },
  {
    name: 'thumbnail_generated',
    nullCast: 'boolean',
    sources: { file: 'thumbnail_generated' },
  },
  {
    name: 'variants',
    nullCast: 'jsonb',
    sources: { file: 'variants' },
  },

  // -- Relation -------------------------------------------------------------
  {
    name: 'target_document_id',
    nullCast: 'uuid',
    sources: { relation: 'target_document_id' },
  },
  {
    name: 'target_collection_id',
    nullCast: 'uuid',
    sources: { relation: 'target_collection_id' },
  },
  {
    name: 'relationship_type',
    nullCast: 'varchar',
    sources: { relation: 'relationship_type' },
  },
  {
    name: 'cascade_delete',
    nullCast: 'boolean',
    sources: { relation: 'cascade_delete' },
  },

  // -- JSON extras ----------------------------------------------------------
  {
    name: 'json_schema',
    nullCast: 'varchar',
    sources: { json: 'json_schema' },
  },
  {
    name: 'object_keys',
    nullCast: 'text[]',
    sources: { json: 'object_keys' },
  },

  // -- Numeric --------------------------------------------------------------
  {
    name: 'number_type',
    nullCast: 'varchar',
    sources: { numeric: 'number_type' },
  },
  {
    name: 'value_integer',
    nullCast: 'integer',
    sources: { numeric: 'value_integer' },
  },
  {
    name: 'value_decimal',
    nullCast: 'decimal',
    sources: { numeric: 'value_decimal' },
  },
  {
    name: 'value_float',
    nullCast: 'real',
    sources: { numeric: 'value_float' },
  },
]
