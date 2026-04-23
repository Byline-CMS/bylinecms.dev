/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Generated UNION ALL column projections for the EAV store tables.
 *
 * Instead of maintaining 7 hand-synchronized SQL fragments with 41
 * positional columns each, we define a single column manifest and
 * generate the SELECT list for each store table from it. Adding a
 * column or a new store table is a one-line change in the manifest.
 *
 * The adapter-agnostic pieces (`StoreType`, `ALL_STORE_TYPES`,
 * `fieldTypeToStore`, `fieldTypeToStoreType`) live in `@byline/core`
 * so `@byline/client` can consume the same mapping without taking a
 * dependency on this Postgres adapter.
 */

import { ALL_STORE_TYPES, type StoreType } from '@byline/core'
import { type SQL, sql } from 'drizzle-orm'

// Re-export for adapter-internal consumers.
export {
  ALL_STORE_TYPES,
  fieldTypeToStore,
  fieldTypeToStoreType,
  type StoreType,
} from '@byline/core'

/** Short-form alias used by adapter-internal call sites. */
export const allStoreTypes = ALL_STORE_TYPES

// ---------------------------------------------------------------------------
// Column manifest
// ---------------------------------------------------------------------------

/**
 * Each entry describes one column in the unified UNION ALL output.
 *
 * - `name`:     The output column alias (matches UnionRowValue / UnifiedFieldValue).
 * - `nullCast`: The SQL cast applied when a store table does NOT provide this
 *               column (e.g. `'boolean'` → `NULL::boolean`). Only the first
 *               SELECT in a UNION ALL strictly needs casts, but including them
 *               everywhere is harmless and makes each fragment self-describing.
 * - `sources`:  A map from store type key → the SQL expression that produces
 *               this column's value from that table. If a store type is absent,
 *               the column is emitted as `NULL::nullCast`.
 */
interface ColumnDef {
  name: string
  nullCast: string
  sources?: Partial<Record<StoreType, string>>
}

/** Store table names in Postgres, keyed by StoreType. */
export const storeTableNames: Record<StoreType, string> = {
  text: 'byline_store_text',
  numeric: 'byline_store_numeric',
  boolean: 'byline_store_boolean',
  datetime: 'byline_store_datetime',
  json: 'byline_store_json',
  relation: 'byline_store_relation',
  file: 'byline_store_file',
}

/** The field_type literal emitted for each store table in the UNION ALL. */
const fieldTypeLiterals: Record<StoreType, string> = {
  text: 'text',
  numeric: 'numeric',
  boolean: 'boolean',
  datetime: 'datetime',
  json: 'richText',
  relation: 'relation',
  file: 'file',
}

/**
 * Canonical column order for the unified UNION ALL output.
 *
 * The first 8 columns are shared across all store tables (base columns).
 * The remaining columns are type-specific — each one declares which store
 * table(s) provide it and what SQL expression to use.
 */
const columns: ColumnDef[] = [
  // -- Base columns (provided by every store table) -------------------------
  { name: 'id', nullCast: 'uuid' },
  { name: 'document_version_id', nullCast: 'uuid' },
  { name: 'collection_id', nullCast: 'uuid' },
  // field_type is handled specially — see buildSelectList()
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

// ---------------------------------------------------------------------------
// SQL generation
// ---------------------------------------------------------------------------

/** Number of columns in the unified output (base + field_type + type-specific). */
export const UNIFIED_COLUMN_COUNT = columns.length + 1 // +1 for field_type

/**
 * Build the SELECT column list for a given store table type.
 *
 * Base columns (id, document_version_id, etc.) are passed through directly.
 * The `field_type` column is emitted as a string literal.
 * Type-specific columns are either mapped to the source expression or
 * emitted as `NULL::cast`.
 */
function buildSelectList(storeType: StoreType): string {
  const parts: string[] = []

  for (const col of columns) {
    // Base columns (no sources) are always passed through from the table.
    if (!col.sources) {
      parts.push(col.name)
      continue
    }

    const sourceExpr = col.sources[storeType]
    if (sourceExpr) {
      // This store provides this column — use the source expression.
      // If the source column name differs from the output alias, add AS.
      if (sourceExpr === col.name) {
        parts.push(col.name)
      } else {
        parts.push(`${sourceExpr} as "${col.name}"`)
      }
    } else {
      // This store doesn't provide this column — emit typed NULL.
      parts.push(`NULL::${col.nullCast} as "${col.name}"`)
    }
  }

  // Insert field_type after the base columns. The base columns are the first
  // 7 entries (id through parent_path). field_type goes at position 3
  // (after collection_id, before field_path) to match the original layout.
  const fieldTypeLiteral = `'${fieldTypeLiterals[storeType]}' as "field_type"`
  parts.splice(3, 0, fieldTypeLiteral)

  return parts.join(',\n  ')
}

// Pre-generate SQL fragments for each store type.
const selectListCache = new Map<StoreType, SQL>()

/**
 * Get the Drizzle SQL fragment for a store type's SELECT list.
 * Results are cached — the generation runs once at module load.
 */
export function storeSelectList(storeType: StoreType): SQL {
  let cached = selectListCache.get(storeType)
  if (!cached) {
    cached = sql.raw(buildSelectList(storeType))
    selectListCache.set(storeType, cached)
  }
  return cached
}

// ---------------------------------------------------------------------------
// Exported for testing
// ---------------------------------------------------------------------------
export { buildSelectList, columns, fieldTypeLiterals }
