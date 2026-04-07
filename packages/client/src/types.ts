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

export interface FindOptions {
  /** Filter documents. Keys are field names or reserved names (status, path). */
  where?: WhereClause
  /** Return only these fields. Omit for all fields. */
  select?: string[]
  /** Sort specification. Keys are field names or document-level columns. */
  sort?: SortSpec
  /** Locale for field value resolution. Defaults to 'en'. */
  locale?: string
  /** Page number (1-based). Defaults to 1. */
  page?: number
  /** Documents per page. Defaults to 20. */
  pageSize?: number
}

export interface FindOneOptions {
  where?: WhereClause
  select?: string[]
  locale?: string
}

export interface FindByIdOptions {
  select?: string[]
  locale?: string
}

export interface FindByPathOptions {
  select?: string[]
  locale?: string
}

// ---------------------------------------------------------------------------
// Where clause
// ---------------------------------------------------------------------------

/**
 * A where clause maps field names (or reserved document-level names like
 * `status` and `path`) to either a bare value (equality) or an operator object.
 *
 * Phase 1 supports:
 * - `status` (exact match on document status column)
 * - `query` (text search across collection's configured search fields)
 *
 * Field-level operators ($gt, $contains, etc.) are deferred to Phase 2.
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

export interface ClientDocument {
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
  fields: Record<string, any>
}

export interface FindResult {
  docs: ClientDocument[]
  meta: {
    total: number
    page: number
    pageSize: number
    totalPages: number
  }
}

export interface CountResult {
  total: number
}
