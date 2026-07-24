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
 * independent and lives in `@byline/core` so a future adapter (e.g. MySQL)
 * can consume the same column list without duplicating it. This module
 * owns everything Postgres-specific: the generated Drizzle `SQL` fragments,
 * and `pgNullCast()`, which renders the manifest's abstract `nullCast` type
 * names (`'uuid'`, `'boolean'`, …) as Postgres `NULL::<cast>` expressions.
 *
 * The adapter-agnostic pieces (`StoreType`, `ALL_STORE_TYPES`,
 * `fieldTypeToStore`, `fieldTypeToStoreType`) also live in `@byline/core`
 * so `@byline/client` can consume the same mapping without taking a
 * dependency on this Postgres adapter.
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
 * Map the manifest's abstract `nullCast` type name to its Postgres SQL cast
 * expression (e.g. `'uuid'` → `'NULL::uuid'`).
 */
export function pgNullCast(nullCast: string): string {
  return `NULL::${nullCast}`
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
        parts.push(`${sourceExpr} as "${col.name}"`)
      }
    } else {
      // This store doesn't provide this column — emit typed NULL.
      parts.push(`${pgNullCast(col.nullCast)} as "${col.name}"`)
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
export { buildSelectList, fieldTypeLiterals }
