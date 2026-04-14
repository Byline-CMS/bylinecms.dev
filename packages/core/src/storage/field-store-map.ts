/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Adapter-agnostic mapping between collection field types and the EAV store
 * tables they read from and write to. Both @byline/db-postgres (for UNION ALL
 * generation and filter SQL) and @byline/client (for translating client-API
 * where clauses into FieldFilter descriptors) consume this module — keeping
 * the mapping in a single place prevents the two sides from drifting.
 *
 * Column names (`value`, `value_integer`, `value_timestamp_tz`, …) are shared
 * between the adapter schema and the filter builder by design: the EAV store
 * tables are the product's public storage contract, not a Postgres-only
 * implementation detail. A future MySQL adapter is expected to mirror the
 * same column names.
 */

// ---------------------------------------------------------------------------
// Store types
// ---------------------------------------------------------------------------

/** The seven EAV store table types. */
export type StoreType = 'text' | 'numeric' | 'boolean' | 'datetime' | 'json' | 'relation' | 'file'

/**
 * Canonical order of store types — used by adapters when assembling the
 * UNION ALL that reconstructs a document from its per-type rows.
 */
export const ALL_STORE_TYPES: readonly StoreType[] = [
  'text',
  'numeric',
  'boolean',
  'datetime',
  'json',
  'relation',
  'file',
] as const

// ---------------------------------------------------------------------------
// Field type → store mapping
// ---------------------------------------------------------------------------

/** Resolved store location for a single-value field type. */
export interface FieldStoreMapping {
  /** The EAV store table that holds the field's data. */
  storeType: StoreType
  /**
   * The column within the store table that holds the scalar value.
   * Used for filter WHERE conditions and sort expressions.
   */
  valueColumn: string
}

/**
 * Field type → EAV store table + value column.
 *
 * Structure fields (`group`, `array`, `blocks`) and the `meta` category do
 * not appear here — they are handled separately via `fieldTypeToStoreType`.
 */
export const fieldTypeToStore: Readonly<Record<string, FieldStoreMapping | undefined>> = {
  // Text store
  text: { storeType: 'text', valueColumn: 'value' },
  textArea: { storeType: 'text', valueColumn: 'value' },
  select: { storeType: 'text', valueColumn: 'value' },

  // Numeric store
  integer: { storeType: 'numeric', valueColumn: 'value_integer' },
  float: { storeType: 'numeric', valueColumn: 'value_float' },
  decimal: { storeType: 'numeric', valueColumn: 'value_decimal' },

  // Boolean store
  boolean: { storeType: 'boolean', valueColumn: 'value' },
  checkbox: { storeType: 'boolean', valueColumn: 'value' },

  // DateTime store
  date: { storeType: 'datetime', valueColumn: 'value_date' },
  time: { storeType: 'datetime', valueColumn: 'value_time' },
  datetime: { storeType: 'datetime', valueColumn: 'value_timestamp_tz' },

  // JSON store
  richText: { storeType: 'json', valueColumn: 'value' },
  json: { storeType: 'json', valueColumn: 'value' },
  object: { storeType: 'json', valueColumn: 'value' },

  // File store
  file: { storeType: 'file', valueColumn: 'file_id' },
  image: { storeType: 'file', valueColumn: 'file_id' },

  // Relation store
  relation: { storeType: 'relation', valueColumn: 'target_document_id' },
}

// ---------------------------------------------------------------------------
// Field type → store kind (includes structure categories)
// ---------------------------------------------------------------------------

/**
 * Extends StoreType with `'meta'` for structure field types that produce
 * identity rows in `store_meta` (array, blocks). Also accepts `undefined`
 * for structure types that only group children without their own storage.
 */
export type FieldStoreKind = StoreType | 'meta'

/** Derived from `fieldTypeToStore` plus explicit entries for structure fields. */
function deriveFieldTypeToStoreType(): Readonly<Record<string, FieldStoreKind | undefined>> {
  const result: Record<string, FieldStoreKind | undefined> = {}
  for (const [key, mapping] of Object.entries(fieldTypeToStore)) {
    if (mapping) result[key] = mapping.storeType
  }
  // Structure fields carry identity rows in store_meta.
  result.array = 'meta'
  result.blocks = 'meta'
  // Group is a pure nesting wrapper — no rows of its own; callers recurse into children.
  result.group = undefined
  return result
}

/**
 * Field type → store kind, including `'meta'` for structure types that
 * produce identity rows and `undefined` for the pure-nesting `group` type.
 *
 * Used by adapters to resolve which store tables to UNION ALL for a given
 * subset of requested fields (selective field loading).
 */
export const fieldTypeToStoreType = deriveFieldTypeToStoreType()
