/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  BylineLogger,
  CollectionDefinition,
  IDbAdapter,
  IStorageProvider,
  PopulateSpec,
  ReadContext,
  ReadMode,
} from '@byline/core'

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
  /**
   * Optional logger. Used by the write path to emit structured events
   * from `document-lifecycle`. When omitted, the client falls back to
   * `getLogger()` if `initBylineCore()` has registered one, else uses a
   * silent no-op logger so scripts and tests run without setup.
   */
  logger?: BylineLogger
}

// ---------------------------------------------------------------------------
// Query options
// ---------------------------------------------------------------------------

/**
 * Common populate options shared by every read method. `populate` names
 * the relations (or passes `true` for all) to replace with their target
 * documents; `depth` caps the traversal (default 1 when populate is set,
 * 0 otherwise). Clamped to the request's internal `ReadContext.maxDepth`.
 */
interface PopulateControls {
  populate?: PopulateSpec
  depth?: number
  /**
   * Internal plumbing for future read-side hook re-entry. Public callers
   * should leave this undefined; a fresh context is created per top-level
   * call. If provided, it is threaded through populate to preserve the
   * visited set and read budget across nested reads.
   *
   * @internal
   */
  _readContext?: ReadContext
}

/**
 * Read-mode selector shared by every read method.
 *
 *   - `'published'` (client default) — return the latest *published*
 *     version of each document, falling back past newer drafts so public
 *     readers keep seeing previously-published content while editors
 *     work on an unpublished draft. A document with no published
 *     version is invisible in this mode. Populated relation targets
 *     follow the same rule.
 *   - `'any'` — return the latest version regardless of status.
 *     Admin UIs (which surface in-progress drafts) should pass this
 *     explicitly.
 *
 * Distinct from `where.status`, which is an *exact-match filter* on the
 * selected version's status column ("show me all drafts"). `status` is
 * the *source view* selector.
 */
interface StatusControls {
  status?: ReadMode
}

export interface FindOptions<F = Record<string, any>> extends PopulateControls, StatusControls {
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

export interface FindOneOptions<F = Record<string, any>> extends PopulateControls, StatusControls {
  where?: WhereClause
  select?: (keyof F & string)[] | string[]
  locale?: string
}

export interface FindByIdOptions<F = Record<string, any>> extends PopulateControls, StatusControls {
  select?: (keyof F & string)[] | string[]
  locale?: string
}

export interface FindByPathOptions<F = Record<string, any>>
  extends PopulateControls,
    StatusControls {
  select?: (keyof F & string)[] | string[]
  locale?: string
}

// ---------------------------------------------------------------------------
// Write options
// ---------------------------------------------------------------------------

export interface CreateOptions {
  /** Locale for field value resolution. Defaults to 'en'. */
  locale?: string
  /**
   * Initial workflow status. When omitted, `document-lifecycle` derives
   * the collection's default (usually `'draft'`).
   */
  status?: string
}

export interface UpdateOptions {
  /** Locale for field value resolution. Defaults to 'en'. */
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
