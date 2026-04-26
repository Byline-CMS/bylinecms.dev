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
 * The value side of a predicate entry. Either a bare value (interpreted as
 * `$eq`), an operator object, a nested `QueryPredicate` (for cross-collection
 * relation filters or combinator children), or an array of `QueryPredicate`
 * (the value side of `$and` / `$or`).
 */
export type PredicateValue =
  | string
  | number
  | boolean
  | null
  | FilterOperators
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
 * Returning `undefined` from `beforeRead` means "no scoping". Use a
 * sentinel predicate that yields no rows (e.g. `{ id: '__none__' }`)
 * rather than throwing when the actor can read nothing — empty results
 * are the correct shape for list endpoints.
 */
export interface QueryPredicate {
  $and?: QueryPredicate[]
  $or?: QueryPredicate[]
  [key: string]: PredicateValue | undefined
}
