/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition, FieldFilter, FieldFilterOperator } from '@byline/core'
import { fieldTypeToStore } from '@byline/core'

import type { FilterOperators, SortSpec, WhereClause, WhereValue } from '../types.js'

// ---------------------------------------------------------------------------
// Document-level reserved keys
// ---------------------------------------------------------------------------

/** Where clause keys that map to document-level columns, not EAV stores. */
const DOCUMENT_LEVEL_KEYS = new Set(['status', 'path', 'query'])

// ---------------------------------------------------------------------------
// Parsed result
// ---------------------------------------------------------------------------

export interface ParsedWhere {
  /** Filter on document_versions.status (exact match). */
  status?: string
  /** Text search query (for collection-configured search fields). */
  query?: string
  /** Filter on document_versions.path with an operator. */
  pathFilter?: { operator: FieldFilterOperator; value: string }
  /** Field-level filters resolved to store types. */
  fieldFilters: FieldFilter[]
}

export interface ParsedSort {
  /** Field-level sort descriptor (when sorting by a collection field). */
  fieldSort?: {
    fieldName: string
    storeType: string
    valueColumn: string
    direction: 'asc' | 'desc'
  }
  /** Document-level sort column (when sorting by created_at, updated_at, path). */
  orderBy?: string
  orderDirection?: 'asc' | 'desc'
}

// ---------------------------------------------------------------------------
// Document-level sort columns
// ---------------------------------------------------------------------------

const DOCUMENT_SORT_COLUMNS: Record<string, string> = {
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  path: 'path',
  created_at: 'created_at',
  updated_at: 'updated_at',
}

// ---------------------------------------------------------------------------
// Parse functions
// ---------------------------------------------------------------------------

/**
 * Parse a client API `where` clause into document-level conditions and
 * field-level FieldFilter descriptors.
 */
export function parseWhere(
  where: WhereClause | undefined,
  definition: CollectionDefinition
): ParsedWhere {
  const result: ParsedWhere = { fieldFilters: [] }

  if (!where) return result

  for (const [key, rawValue] of Object.entries(where)) {
    // --- Document-level keys -----------------------------------------------
    if (key === 'status') {
      if (typeof rawValue === 'string') {
        result.status = rawValue
      }
      continue
    }

    if (key === 'query') {
      if (typeof rawValue === 'string') {
        result.query = rawValue
      }
      continue
    }

    if (key === 'path') {
      const parsed = normaliseToOperator(rawValue)
      if (parsed) {
        result.pathFilter = {
          operator: parsed.operator,
          value: String(parsed.value),
        }
      }
      continue
    }

    // --- Field-level keys --------------------------------------------------
    const field = definition.fields.find((f) => f.name === key)
    if (!field) continue // Unknown field — skip silently

    const storeInfo = fieldTypeToStore[field.type]
    if (!storeInfo) continue // Structure fields can't be filtered directly

    const parsed = normaliseToOperator(rawValue)
    if (!parsed) continue

    result.fieldFilters.push({
      fieldName: key,
      storeType: storeInfo.storeType,
      valueColumn: storeInfo.valueColumn,
      operator: parsed.operator,
      value: parsed.value,
    })
  }

  return result
}

/**
 * Parse a client API `sort` spec into either a field-level sort descriptor
 * or a document-level order column.
 */
export function parseSort(
  sort: SortSpec | undefined,
  definition: CollectionDefinition
): ParsedSort {
  if (!sort) {
    return { orderBy: 'created_at', orderDirection: 'desc' }
  }

  const entries = Object.entries(sort)
  if (entries.length === 0) {
    return { orderBy: 'created_at', orderDirection: 'desc' }
  }

  const [fieldName, direction] = entries[0]!

  // Check if it's a document-level column
  const docColumn = DOCUMENT_SORT_COLUMNS[fieldName]
  if (docColumn) {
    return { orderBy: docColumn, orderDirection: direction }
  }

  // Check if it's a collection field
  const field = definition.fields.find((f) => f.name === fieldName)
  if (!field) {
    return { orderBy: 'created_at', orderDirection: 'desc' }
  }

  const storeInfo = fieldTypeToStore[field.type]
  if (!storeInfo) {
    return { orderBy: 'created_at', orderDirection: 'desc' }
  }

  return {
    fieldSort: {
      fieldName,
      storeType: storeInfo.storeType,
      valueColumn: storeInfo.valueColumn,
      direction,
    },
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface NormalisedOperator {
  operator: FieldFilterOperator
  value: string | number | boolean | null | Array<string | number>
}

/**
 * Normalise a WhereValue (bare value or operator object) into a single
 * operator + value pair.
 */
function normaliseToOperator(raw: WhereValue): NormalisedOperator | undefined {
  // Bare value → $eq
  if (
    raw === null ||
    typeof raw === 'string' ||
    typeof raw === 'number' ||
    typeof raw === 'boolean'
  ) {
    return { operator: '$eq', value: raw }
  }

  // Operator object
  const ops = raw as FilterOperators
  const operatorEntries = Object.entries(ops) as [string, unknown][]
  if (operatorEntries.length === 0) return undefined

  // Use the first operator found
  const [op, val] = operatorEntries[0]!
  return {
    operator: op as FieldFilterOperator,
    value: val as NormalisedOperator['value'],
  }
}

/** Exported for testing. */
export { DOCUMENT_LEVEL_KEYS, DOCUMENT_SORT_COLUMNS }
