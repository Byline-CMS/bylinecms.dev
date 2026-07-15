/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Comparison operators usable on a single field-level predicate value. The
 * parser normalises a bare value (`'foo'`) to `{ $eq: 'foo' }`; an operator
 * object is taken as-is and the first declared operator wins.
 */
export interface FilterOperators {
  $eq?: string | number | boolean | null
  $ne?: string | number | boolean | null
  $gt?: string | number
  $gte?: string | number
  $lt?: string | number
  $lte?: string | number
  $contains?: string
  $in?: Array<string | number>
  $nin?: Array<string | number>
}

/**
 * Quantifiers usable on a relation field's predicate value — the multi-target
 * (`hasMany`) analogue of a nested sub-where. Each key carries a nested
 * `QueryPredicate` evaluated against the relation's *targets*:
 *
 *   - `$some`  — at least one target matches (a bare nested sub-where on a
 *     relation field is shorthand for this).
 *   - `$every` — no target fails the predicate. Vacuously true when the
 *     document has no targets on the field (Prisma-style semantics).
 *   - `$none`  — no target matches. `$none: {}` matches documents with no
 *     (resolving) targets at all.
 *
 * Multiple quantifier keys on one field AND together. Also valid on single
 * relations (a set of ≤ 1). Targets that don't resolve in the selected read
 * view (deleted, or unpublished under published-mode reads) are ignored.
 */
export interface RelationQuantifiers {
  $some?: QueryPredicate
  $every?: QueryPredicate
  $none?: QueryPredicate
}

/**
 * The value side of a predicate entry. Either a bare value (interpreted as
 * `$eq`), an operator object, a nested `QueryPredicate` (for cross-collection
 * relation filters or combinator children), a `RelationQuantifiers` object
 * (relation fields only), or an array of `QueryPredicate` (the value side of
 * `$and` / `$or`).
 */
export type PredicateValue =
  | string
  | number
  | boolean
  | null
  | FilterOperators
  | RelationQuantifiers
  | QueryPredicate
  | QueryPredicate[]

/**
 * Structured predicate language used by:
 *   - the client API's `where` clause (re-exported as `WhereClause`),
 *   - the `CollectionHooks.beforeRead` hook return value.
 *
 * Keys are field names declared on the collection, with three exceptions:
 *
 *   - `$and: QueryPredicate[]` — every child must match.
 *   - `$or:  QueryPredicate[]` — at least one child must match.
 *   - reserved client-side keys (`status`, `query`, `path`) that the
 *     `parseWhere` parser maps to document-level columns at the top level.
 *     `beforeRead` predicates may use these too, with the same semantics.
 *
 * Field-name keys resolve through `field-store-map` and compile into the
 * existing `EXISTS` / `LEFT JOIN LATERAL` SQL machinery — no new SQL
 * primitives. Combinators nest freely:
 *
 * ```ts
 * {
 *   $or: [
 *     { status: 'published' },
 *     { status: 'draft', authorId: actor.id },
 *   ],
 * }
 * ```
 *
 * Returning `undefined` from `beforeRead` means "no scoping". Use
 * `{ id: { $in: [] } }` as the always-false predicate rather than an invalid
 * UUID sentinel or an exception when the actor can read nothing. Empty results
 * are the correct shape for list endpoints.
 */
export interface QueryPredicate {
  $and?: QueryPredicate[]
  $or?: QueryPredicate[]
  [key: string]: PredicateValue | undefined
}

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

export type SortDirection = 'asc' | 'desc'

/**
 * A sort specification — `{ fieldName: direction }`. Field names resolve
 * through `field-store-map` to a LATERAL JOIN; document-level columns
 * (`createdAt`, `updatedAt`, `path`) compile to a direct `ORDER BY`.
 */
export type SortSpec = Record<string, SortDirection>
