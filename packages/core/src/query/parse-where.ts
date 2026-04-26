/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { fieldTypeToStore } from '../storage/field-store-map.js'
import type {
  CombinatorFilter,
  DocumentFilter,
  FieldFilter,
  FieldFilterOperator,
  RelationFilter,
} from '../@types/db-types.js'
import type { CollectionDefinition } from '../@types/index.js'
import type {
  FilterOperators,
  PredicateValue,
  QueryPredicate,
  SortSpec,
} from '../@types/query-predicate.js'
import type { BylineLogger } from '../lib/logger.js'

// Internal aliases — `parse-where` was originally written against the
// client's `WhereClause` / `WhereValue` types, now back-compat aliases
// for `QueryPredicate` / `PredicateValue`. Keeping the names lets the
// existing function bodies stay unchanged.
type WhereClause = QueryPredicate
type WhereValue = PredicateValue

// ---------------------------------------------------------------------------
// Document-level reserved keys
// ---------------------------------------------------------------------------

/** Where clause keys that map to document-level columns, not EAV stores. */
const DOCUMENT_LEVEL_KEYS = new Set(['status', 'path', 'query'])

// ---------------------------------------------------------------------------
// Parse context
// ---------------------------------------------------------------------------

/**
 * Optional context used to resolve cross-collection relation filters.
 *
 * When the `where` clause traverses a relation field with a nested
 * sub-clause (e.g. `{ category: { path: 'news' } }`), the parser needs
 * (a) the target collection's definition to resolve nested field types
 * and (b) the target collection's DB row id to emit the adapter-facing
 * `RelationFilter.targetCollectionId`.
 *
 * When `ctx` is omitted, nested relation sub-clauses are silently
 * skipped — bare-value or operator-object values on relation fields
 * still produce ordinary `$eq`-style filters against
 * `store_relation.target_document_id`.
 */
export interface ParseContext {
  /** All registered collection definitions. */
  collections: CollectionDefinition[]
  /** Resolve a collection path → DB row id. */
  resolveCollectionId: (path: string) => Promise<string>
  /**
   * Optional logger. When provided, dropped nested relation sub-clauses
   * (unknown target collection, misconfigured relation field) emit a
   * `debug` line so a regression is observable. Safe to omit.
   */
  logger?: BylineLogger
}

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
  /**
   * Adapter-facing filter list: ordinary field filters and cross-collection
   * relation filters, intermixed. Consumed by
   * `IDocumentQueries.findDocuments({ filters })`.
   */
  filters: DocumentFilter[]
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
 * adapter-facing DocumentFilter descriptors. When `ctx` is provided,
 * nested relation sub-clauses (e.g. `{ category: { path: 'news' } }`)
 * are resolved into `RelationFilter` entries; otherwise only
 * direct/operator predicates against the relation's own
 * `target_document_id` are emitted.
 */
export async function parseWhere(
  where: WhereClause | undefined,
  definition: CollectionDefinition,
  ctx?: ParseContext
): Promise<ParsedWhere> {
  return parseWhereInternal(where, definition, ctx, { isNested: false })
}

/**
 * Combine a `beforeRead` hook predicate with a caller-supplied where
 * clause using implicit AND. Returns whichever side is non-empty, or
 * wraps both in `$and` when both are present.
 *
 * Defined at the predicate level (rather than merging two `ParsedWhere`
 * outputs) so the result still flows through `parseWhere` once — there
 * is one normalisation pass and one place where reserved keys, relation
 * lookups, and combinator flattening happen. `null` is treated the same
 * as `undefined` (the cache value `null` records "hook ran and applied
 * no scoping").
 */
export function mergePredicates(
  hookPredicate: QueryPredicate | null | undefined,
  userWhere: WhereClause | undefined
): WhereClause | undefined {
  if (!hookPredicate && !userWhere) return undefined
  if (!hookPredicate) return userWhere
  if (!userWhere) return hookPredicate
  return { $and: [hookPredicate, userWhere] }
}

/**
 * Recursion entry point. `isNested: true` disables the top-level reserved
 * keys (`status`, `query`, `path`) so that on a nested sub-where, those
 * names resolve as ordinary fields on the target collection (where `path`
 * and `status` are typically real text fields).
 */
async function parseWhereInternal(
  where: WhereClause | undefined,
  definition: CollectionDefinition,
  ctx: ParseContext | undefined,
  { isNested }: { isNested: boolean }
): Promise<ParsedWhere> {
  const result: ParsedWhere = { filters: [] }

  if (!where) return result

  for (const [key, rawValue] of Object.entries(where)) {
    // The shared `QueryPredicate` index signature includes `undefined` so it
    // can coexist with the optional `$and` / `$or` combinator properties;
    // skip explicit-undefined entries up front so the rest of this loop can
    // assume a concrete value.
    if (rawValue === undefined) continue

    // --- Boolean combinators ---------------------------------------------
    // `$and` / `$or` carry an array of child predicates. Each child is
    // parsed in its own scope (an `$or` child is itself an implicit AND of
    // its keys); the resulting `DocumentFilter[]` is wrapped in a
    // CombinatorFilter and added to the outer filter list.
    //
    // Top-level `$and` is structurally redundant with the implicit AND
    // across `result.filters`, so we flatten it: parse each child and
    // splice its filters in. The combinator only earns its keep when
    // nested under `$or` (or vice versa). Document-level reserved-key
    // results (status / query / pathFilter) inside combinators are
    // intentionally dropped — they don't compose with OR semantics and
    // belong at the top level of the where clause.
    if (key === '$and' || key === '$or') {
      if (!Array.isArray(rawValue)) {
        ctx?.logger?.debug(
          { key, collection: definition.path },
          'parse-where: dropping combinator — value is not an array of predicates'
        )
        continue
      }

      const childFilters: DocumentFilter[][] = []
      for (const child of rawValue as QueryPredicate[]) {
        const childParsed = await parseWhereInternal(child, definition, ctx, { isNested })
        childFilters.push(childParsed.filters)
      }

      if (key === '$and') {
        // Flatten: AND over [[a, b], [c]] becomes [a, b, c] at the outer
        // level since the outer scope is itself implicit-AND.
        for (const group of childFilters) result.filters.push(...group)
      } else {
        // `$or`: each child group is itself implicit-AND, so wrap each
        // group in an inner `and` combinator (when it has more than one
        // filter) and emit a single outer `or` combinator over the lot.
        // Empty child groups (parsed to nothing) are skipped — keeping
        // them would change semantics ("OR with always-true").
        const orChildren: DocumentFilter[] = []
        for (const group of childFilters) {
          if (group.length === 0) continue
          if (group.length === 1) {
            orChildren.push(group[0]!)
          } else {
            orChildren.push({ kind: 'and', children: group } satisfies CombinatorFilter)
          }
        }
        if (orChildren.length > 0) {
          result.filters.push({ kind: 'or', children: orChildren } satisfies CombinatorFilter)
        }
      }
      continue
    }

    // --- Document-level reserved keys (top-level only) ---------------------
    if (!isNested) {
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
    }

    // --- Field-level keys --------------------------------------------------
    const field = definition.fields.find((f) => f.name === key)
    if (!field) continue // Unknown field — skip silently

    // Relation field with a plain-object sub-clause → cross-collection filter.
    // A "plain object with no $-prefixed top-level keys" is unambiguously a
    // nested where; anything else (bare value, operator object) stays in the
    // ordinary field-filter path below and matches the relation's
    // target_document_id column directly.
    if (field.type === 'relation' && isPlainSubWhere(rawValue)) {
      if (!ctx) {
        // No way to resolve the target without a ParseContext. Direct
        // callers of `parseWhere` (tests, tooling) can legitimately hit
        // this path; CollectionHandle always provides one.
        continue
      }

      const relation = field as { targetCollection?: string }
      const targetPath = relation.targetCollection
      if (!targetPath) {
        ctx.logger?.debug(
          { fieldName: key, collection: definition.path },
          'parse-where: dropping nested relation sub-clause — relation field has no targetCollection'
        )
        continue
      }

      const targetDef = ctx.collections.find((c) => c.path === targetPath)
      if (!targetDef) {
        ctx.logger?.debug(
          { fieldName: key, targetPath, collection: definition.path },
          'parse-where: dropping nested relation sub-clause — target collection not registered'
        )
        continue
      }

      const targetCollectionId = await ctx.resolveCollectionId(targetPath)
      const nested = await parseWhereInternal(rawValue as WhereClause, targetDef, ctx, {
        isNested: true,
      })

      // Flatten nested: only field-level / relation-level conditions make
      // sense inside a relation subclause. Document-level keys (status,
      // path, query) on the target are deliberately out of scope for this
      // first phase — they can be added later by promoting them into
      // the nested filter list here.
      result.filters.push({
        kind: 'relation',
        fieldName: key,
        targetCollectionId,
        nested: nested.filters,
      } satisfies RelationFilter)
      continue
    }

    const storeInfo = fieldTypeToStore[field.type]
    if (!storeInfo) continue // Structure fields can't be filtered directly

    const parsed = normaliseToOperator(rawValue)
    if (!parsed) continue

    result.filters.push({
      kind: 'field',
      fieldName: key,
      storeType: storeInfo.storeType,
      valueColumn: storeInfo.valueColumn,
      operator: parsed.operator,
      value: parsed.value,
    } satisfies FieldFilter)
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
 * Predicate-level combinator keys. These are `$`-prefixed but, unlike
 * operator keys (`$eq`, `$ne`, …), they are valid inside a "plain
 * sub-where" because their value is a list of nested predicates rather
 * than a comparison value.
 */
const COMBINATOR_KEYS = new Set(['$and', '$or'])

/**
 * A "plain sub-where" is a non-null, non-array object whose top-level keys
 * are field names or predicate-level combinators (`$and` / `$or`) — but
 * **not** comparison-operator keys (`$eq`, `$ne`, …). Used to disambiguate
 * `{ category: { path: 'news' } }` (nested where against the target) from
 * `{ category: { $eq: 'abc-id' } }` (operator object on the relation's own
 * `target_document_id`).
 */
function isPlainSubWhere(raw: unknown): raw is Record<string, unknown> {
  if (raw === null || typeof raw !== 'object') return false
  if (Array.isArray(raw)) return false
  const keys = Object.keys(raw as Record<string, unknown>)
  // An empty object is not a meaningful sub-where; treat as non-match
  // (ordinary field-filter path will then reject it via normaliseToOperator).
  if (keys.length === 0) return false
  for (const k of keys) {
    if (k.startsWith('$') && !COMBINATOR_KEYS.has(k)) return false
  }
  return true
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
