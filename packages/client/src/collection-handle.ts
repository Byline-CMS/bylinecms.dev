/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition } from '@byline/core'

import { parseSort, parseWhere } from './query/parse-where.js'
import { shapeDocument } from './response.js'
import type { BylineClient } from './client.js'
import type {
  ClientDocument,
  FindByIdOptions,
  FindByPathOptions,
  FindOneOptions,
  FindOptions,
  FindResult,
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
   * All queries are routed through `findDocuments()` which supports
   * document-level conditions (status, text search), field-level filters
   * (EXISTS subqueries against EAV store tables), and field-level sorting
   * (LATERAL JOINs).
   */
  async find(options: FindOptions = {}): Promise<FindResult> {
    const collectionId = await this.client.resolveCollectionId(this.definition.path)
    const { where, select, sort, locale = 'en', page = 1, pageSize = 20 } = options

    const parsedWhere = parseWhere(where, this.definition)
    const parsedSort = parseSort(sort, this.definition)

    const result = await this.client.db.queries.documents.findDocuments({
      collection_id: collectionId,
      filters: parsedWhere.fieldFilters,
      status: parsedWhere.status,
      pathFilter: parsedWhere.pathFilter,
      query: parsedWhere.query,
      sort: parsedSort.fieldSort,
      orderBy: parsedSort.orderBy,
      orderDirection: parsedSort.orderDirection,
      locale,
      page,
      pageSize,
      fields: select,
    })

    return {
      docs: result.documents.map(shapeDocument),
      meta: {
        total: result.total,
        page,
        pageSize,
        totalPages: Math.ceil(result.total / pageSize),
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
