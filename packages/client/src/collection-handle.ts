/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition } from '@byline/core'

import { shapeDocument } from './response.js'
import type { BylineClient } from './client.js'
import type {
  ClientDocument,
  FindByIdOptions,
  FindByPathOptions,
  FindOneOptions,
  FindOptions,
  FindResult,
  SortSpec,
} from './types.js'

/**
 * A handle scoped to a single collection. Provides read (and eventually write)
 * operations against that collection's documents.
 *
 * Created via `client.collection('posts')`.
 */
export class CollectionHandle {
  private client: BylineClient
  private definition: CollectionDefinition

  constructor(client: BylineClient, definition: CollectionDefinition) {
    this.client = client
    this.definition = definition
  }

  /**
   * Find documents with optional filtering, sorting, pagination, and field
   * selection.
   *
   * Phase 1 supports:
   * - `where.status` — filter by workflow status
   * - `where.query` — text search across configured search fields
   * - `select` — selective field loading
   * - `sort` — single-field sort (document-level columns only in Phase 1)
   * - `page` / `pageSize` — pagination
   * - `locale` — field value locale resolution
   */
  async find(options: FindOptions = {}): Promise<FindResult> {
    const collectionId = await this.client.resolveCollectionId(this.definition.path)
    const { where, select, sort, locale = 'en', page = 1, pageSize = 20 } = options

    // Extract supported where conditions.
    const status = typeof where?.status === 'string' ? where.status : undefined
    const query = typeof where?.query === 'string' ? where.query : undefined

    // Resolve sort — Phase 1 supports document-level columns only.
    const { order, desc } = resolveSortSpec(sort)

    const result = await this.client.db.queries.documents.getDocumentsByPage({
      collection_id: collectionId,
      locale,
      page,
      page_size: pageSize,
      order,
      desc,
      query,
      status,
      fields: select,
    })

    return {
      docs: result.documents.map(shapeDocument),
      meta: {
        total: result.meta.total,
        page: result.meta.page,
        pageSize: result.meta.page_size,
        totalPages: result.meta.total_pages,
      },
    }
  }

  /**
   * Find a single document matching the given options. Returns `null` if no
   * document matches.
   */
  async findOne(options: FindOneOptions = {}): Promise<ClientDocument | null> {
    const result = await this.find({
      where: options.where,
      select: options.select,
      locale: options.locale,
      page: 1,
      pageSize: 1,
    })
    return result.docs[0] ?? null
  }

  /**
   * Find a document by its logical document ID.
   */
  async findById(
    documentId: string,
    options: FindByIdOptions = {}
  ): Promise<ClientDocument | null> {
    const collectionId = await this.client.resolveCollectionId(this.definition.path)
    const { locale = 'en' } = options

    const raw = await this.client.db.queries.documents.getDocumentById({
      collection_id: collectionId,
      document_id: documentId,
      locale,
      reconstruct: true,
    })

    if (raw == null) return null

    const doc = shapeDocument(raw as Record<string, any>)

    // Trim to selected fields if requested.
    if (options.select?.length) {
      doc.fields = Object.fromEntries(
        Object.entries(doc.fields).filter(([k]) => options.select?.includes(k))
      )
    }

    return doc
  }

  /**
   * Find a document by its URL path/slug.
   */
  async findByPath(path: string, options: FindByPathOptions = {}): Promise<ClientDocument | null> {
    const collectionId = await this.client.resolveCollectionId(this.definition.path)
    const { locale = 'en' } = options

    try {
      const raw = await this.client.db.queries.documents.getDocumentByPath({
        collection_id: collectionId,
        path,
        locale,
        reconstruct: true,
      })

      if (raw == null) return null

      const doc = shapeDocument(raw as Record<string, any>)

      if (options.select?.length) {
        doc.fields = Object.fromEntries(
          Object.entries(doc.fields).filter(([k]) => options.select?.includes(k))
        )
      }

      return doc
    } catch {
      // getDocumentByPath throws when not found rather than returning null
      return null
    }
  }

  /**
   * Count documents, optionally filtered by status.
   *
   * When called with no arguments or `where.status`, uses the optimised
   * `getDocumentCountsByStatus()` query which groups by status.
   */
  async count(where?: { status?: string }): Promise<number> {
    const collectionId = await this.client.resolveCollectionId(this.definition.path)

    const counts = await this.client.db.queries.documents.getDocumentCountsByStatus({
      collection_id: collectionId,
    })

    if (where?.status) {
      const match = counts.find((c) => c.status === where.status)
      return match?.count ?? 0
    }

    // No status filter — sum all statuses.
    return counts.reduce((sum, c) => sum + c.count, 0)
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Convert a SortSpec to the order/desc pair that getDocumentsByPage expects.
 *
 * Phase 1 only supports document-level sort columns (created_at, path).
 * Field-level sorting requires the query builder (Phase 2).
 */
function resolveSortSpec(sort?: SortSpec): { order: string; desc: boolean } {
  if (!sort) {
    return { order: 'created_at', desc: true }
  }

  const entries = Object.entries(sort)
  if (entries.length === 0) {
    return { order: 'created_at', desc: true }
  }

  // Use the first sort key. Map camelCase client names to storage column names.
  const [field, direction] = entries[0]!
  const columnMap: Record<string, string> = {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    path: 'path',
    // Pass through storage-format names as well.
    created_at: 'created_at',
    updated_at: 'updated_at',
  }

  const order = columnMap[field] ?? 'created_at'
  const desc = direction === 'desc'

  return { order, desc }
}
