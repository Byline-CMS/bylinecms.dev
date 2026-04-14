/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition, IDbAdapter, IStorageProvider } from '@byline/core'

// ---------------------------------------------------------------------------
// Client construction
// ---------------------------------------------------------------------------

export interface BylineClientConfig {
  /** The database adapter (e.g. from @byline/db-postgres). */
  db: IDbAdapter
  /** All registered collection definitions. */
  collections: CollectionDefinition[]
  /** Optional storage provider — needed for delete file cleanup. */
  storage?: IStorageProvider
}

// ---------------------------------------------------------------------------
// Query options
// ---------------------------------------------------------------------------

export interface FindOptions<F = Record<string, any>> {
  /** Filter documents. Keys are field names or reserved names (status, path). */
  where?: WhereClause
  /** Return only these fields. Omit for all fields. */
  select?: (keyof F & string)[] | string[]
  /** Sort specification. Keys are field names or document-level columns. */
  sort?: SortSpec
  /** Locale for field value resolution. Defaults to 'en'. */
  locale?: string
  /** Page number (1-based). Defaults to 1. */
  page?: number
  /** Documents per page. Defaults to 20. */
  pageSize?: number
}

export interface FindOneOptions<F = Record<string, any>> {
  where?: WhereClause
  select?: (keyof F & string)[] | string[]
  locale?: string
}

export interface FindByIdOptions<F = Record<string, any>> {
  select?: (keyof F & string)[] | string[]
  locale?: string
}

export interface FindByPathOptions<F = Record<string, any>> {
  select?: (keyof F & string)[] | string[]
  locale?: string
}

// ---------------------------------------------------------------------------
// Where clause
// ---------------------------------------------------------------------------

/**
 * A where clause maps field names (or reserved document-level names like
 * `status` and `path`) to either a bare value (equality) or an operator
 * object. Reserved keys:
 *   - `status` — exact match on document version status column
 *   - `query`  — text search across the collection's configured search fields
 *   - `path`   — document version path column (supports operators)
 *
 * All other keys are resolved against the collection's field definitions
 * and compiled into EXISTS subqueries over the EAV store tables.
 */
export type WhereClause = Record<string, WhereValue>

export type WhereValue = string | number | boolean | null | FilterOperators

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

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

export type SortDirection = 'asc' | 'desc'

export type SortSpec = Record<string, SortDirection>

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

/**
 * Shape of a document returned by the client API.
 *
 * The generic parameter `F` types the `fields` object. Callers that know
 * their collection's shape can narrow it:
 *
 * ```ts
 * interface Post { title: string; body: string }
 * const post = await client.collection('posts').findById<Post>(id)
 * post?.fields.title // typed as string
 * ```
 *
 * Defaults to `Record<string, any>` when no shape is provided.
 */
export interface ClientDocument<F = Record<string, any>> {
  /** Logical document ID. */
  id: string
  /** The specific version ID for this document. */
  versionId: string
  /** URL-friendly slug/path for this document. */
  path: string
  /** Workflow status (e.g. 'draft', 'published'). */
  status: string
  /** When this version was created. */
  createdAt: Date
  /** When this version was last updated. */
  updatedAt: Date
  /** Reconstructed field data. */
  fields: F
}

export interface FindResult<F = Record<string, any>> {
  docs: ClientDocument<F>[]
  meta: {
    total: number
    page: number
    pageSize: number
    totalPages: number
  }
}
