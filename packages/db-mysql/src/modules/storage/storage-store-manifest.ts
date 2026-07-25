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
 * positional columns each, we generate the SELECT list for each store
 * table from a single column manifest. Adding a column or a new store
 * table is a one-line change in the manifest.
 *
 * The manifest data (`storeColumnManifest`, `storeTableNames`) is dialect
 * independent and lives in `@byline/core` — the same manifest
 * `@byline/db-postgres` consumes. This module owns everything
 * MySQL-specific: the generated `SQL` fragments, and `mysqlNullCast()`,
 * which renders the manifest's abstract `nullCast` type names (`'uuid'`,
 * `'boolean'`, …) as MySQL `CAST(NULL AS <type>)` expressions — MySQL has
 * no `NULL::<type>` shorthand.
 *
 * The adapter-agnostic pieces (`StoreType`, `ALL_STORE_TYPES`,
 * `fieldTypeToStore`, `fieldTypeToStoreType`) also live in `@byline/core`
 * so `@byline/client` can consume the same mapping without taking a
 * dependency on either adapter. Mirrors
 * `packages/db-postgres/src/modules/storage/storage-store-manifest.ts`.
 */

import { ALL_STORE_TYPES, type StoreType, storeColumnManifest } from '@byline/core'
import { type SQL, sql } from 'drizzle-orm'

// Re-export for adapter-internal consumers.
export {
  ALL_STORE_TYPES,
  fieldTypeToStore,
  fieldTypeToStoreType,
  type StoreType,
  storeTableNames,
} from '@byline/core'

/** Short-form alias used by adapter-internal call sites. */
export const allStoreTypes = ALL_STORE_TYPES

// ---------------------------------------------------------------------------
// SQL generation
// ---------------------------------------------------------------------------

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
 * Map the manifest's abstract `nullCast` type name to its MySQL `CAST(NULL
 * AS <type>)` expression. MySQL has no `NULL::<type>` shorthand (that's
 * Postgres-only syntax), so every branch of the UNION ALL that doesn't
 * provide a given column emits an explicit `CAST`.
 *
 * Each mapping was verified against the live MySQL 9.7.1 container (not
 * just read from the docs) by UNIONing a `CAST(NULL AS …)` branch against a
 * branch selecting a real, populated column of the corresponding store type
 * and confirming the driver returns the real value unmodified (no
 * truncation, no precision loss) — see the Task 10A report for the
 * transcript. Precision-bearing casts (`TIME(3)`, `DATETIME(3)`,
 * `DECIMAL(10,2)`) mirror the schema's own column precision
 * (`packages/db-mysql/src/database/schema/index.ts`) exactly, rather than
 * relying on MySQL's default (whole-second time, `DECIMAL(10,0)`), so a
 * NULL-cast branch can never be the one that silently narrows the unified
 * column's type.
 */
export function mysqlNullCast(nullCast: string): string {
  switch (nullCast) {
    case 'uuid':
      return 'CAST(NULL AS CHAR(36))'
    case 'boolean':
      return 'CAST(NULL AS SIGNED)'
    case 'timestamp':
      // The manifest's abstract name for the `timestamptz`-shaped column
      // (`value_timestamp_tz`); MySQL's storage-side type is `DATETIME(3)`
      // (spec §2 — UTC by convention), not a MySQL `TIMESTAMP` column.
      return 'CAST(NULL AS DATETIME(3))'
    case 'date':
      return 'CAST(NULL AS DATE)'
    case 'time':
      return 'CAST(NULL AS TIME(3))'
    case 'jsonb':
      return 'CAST(NULL AS JSON)'
    case 'text':
    case 'varchar':
      return 'CAST(NULL AS CHAR)'
    case 'bigint':
    case 'integer':
      return 'CAST(NULL AS SIGNED)'
    case 'decimal':
      return 'CAST(NULL AS DECIMAL(10,2))'
    case 'real':
      return 'CAST(NULL AS FLOAT)'
    case 'text[]':
      // No MySQL array type — `object_keys` is stored as a JSON array of
      // strings on this adapter (see the manifest's own comment at its
      // `object_keys` entry), so the null cast matches that column's real
      // MySQL type.
      return 'CAST(NULL AS JSON)'
    default:
      throw new Error(`mysqlNullCast: unrecognised nullCast type '${nullCast}'`)
  }
}

/** Number of columns in the unified output (base + field_type + type-specific). */
export const UNIFIED_COLUMN_COUNT = storeColumnManifest.length + 1 // +1 for field_type

/**
 * Build the SELECT column list for a given store table type.
 *
 * Base columns (id, document_version_id, etc.) are passed through directly.
 * The `field_type` column is emitted as a string literal.
 * Type-specific columns are either mapped to the source expression or
 * emitted as a typed NULL.
 */
function buildSelectList(storeType: StoreType): string {
  const parts: string[] = []

  for (const col of storeColumnManifest) {
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
        parts.push(`${sourceExpr} as \`${col.name}\``)
      }
    } else {
      // This store doesn't provide this column — emit typed NULL.
      parts.push(`${mysqlNullCast(col.nullCast)} as \`${col.name}\``)
    }
  }

  // Insert field_type after the base columns. The base columns are the first
  // 7 entries (id through parent_path). field_type goes at position 3
  // (after collection_id, before field_path) to match the original layout.
  const fieldTypeLiteral = `'${fieldTypeLiterals[storeType]}' as \`field_type\``
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
export { buildSelectList, fieldTypeLiterals }
