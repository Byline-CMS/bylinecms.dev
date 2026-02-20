/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { ICollectionQueries, IDocumentQueries } from '@byline/core'

/**
 * CollectionQueries
 */
export class CollectionQueries implements ICollectionQueries {
  /**
   * getAllCollections
   *
   * @returns
   */
  // @ts-expect-error
  async getAllCollections() {
    throw new Error('db-remote method not implemented.')
  }

  /**
   * getCollectionByPath
   *
   * @param path
   * @returns
   */
  async getCollectionByPath(_path: string) {
    throw new Error('db-remote method not implemented.')
  }

  /**
   * getCollectionById
   *
   * @param id
   * @returns
   */
  async getCollectionById(_id: string) {
    throw new Error('db-remote method not implemented.')
  }
}

/**
 * DocumentQueries
 */
export class DocumentQueries implements IDocumentQueries {
  /**
   * getAllDocuments
   *
   * Unlikely to use this. Here mainly for testing.
   *
   * @param collectionId
   * @param locale
   * @returns
   */
  async getAllDocuments({
    collection_id,
    locale = 'all',
  }: {
    collection_id: string
    locale?: string
  }): Promise<any[]> {
    throw new Error('db-remote method not implemented.')
  }

  /**
   * getDocumentsByBatch
   *
   * Also unlikely to use often. Mainly for testing and perhaps migration scripts.
   *
   * @param collectionId
   * @param locale
   * @param batchSize
   * @returns
   */
  async getDocumentsByBatch({
    collection_id,
    batch_size = 50,
    locale = 'all',
  }: {
    collection_id: string
    batch_size?: number
    locale?: string
  }): Promise<any[]> {
    throw new Error('db-remote method not implemented.')
  }

  /**
   * getDocumentsByPage
   *
   * Paginated query to get current documents for a collection
   *
   * TODO: We're currently hard coding the query parameter to search by title.
   * However, we can pass the field store name and field_name as options
   *
   * @param collectionId
   * @param options
   * @returns
   */
  async getDocumentsByPage({
    collection_id,
    locale = 'all',
    page = 1,
    page_size = 20,
    order = 'created_at',
    desc = true,
    query,
  }: {
    collection_id: string
    locale?: string
    page?: number
    page_size?: number
    order?: string
    desc?: boolean
    query?: string
  }): Promise<{
    documents: any[]
    meta: {
      total: number
      page: number
      page_size: number
      total_pages: number
      order: string
      desc: boolean
      query?: string
    }
    included: {
      collection: {
        id: string
        path: string
        labels: {
          singular: string
          plural: string
        }
      }
    }
  }> {
    throw new Error('db-remote method not implemented.')
  }

  /**
   * getDocumentById
   *
   * Get's the current version of a document by its logical document ID.
   *
   * @param collection_id
   * @param document_id
   * @returns
   */
  async getDocumentById({
    collection_id,
    document_id,
    locale = 'en',
    reconstruct = true,
  }: {
    collection_id: string
    document_id: string
    locale?: string
    reconstruct?: boolean
  }) {
    throw new Error('db-remote method not implemented.')
  }

  /**
   * getDocumentByPath
   *
   * @param collection_id
   * @param path
   * @returns
   */
  async getDocumentByPath({
    collection_id,
    path,
    locale = 'en',
    reconstruct = true,
  }: {
    collection_id: string
    path: string
    locale?: string
    reconstruct: boolean
  }) {
    throw new Error('db-remote method not implemented.')
  }

  /**
   * getCurrentDocument
   */
  async getDocumentByVersion({
    document_version_id,
    locale = 'all',
  }: {
    document_version_id: string
    locale?: string
  }): Promise<any> {
    throw new Error('db-remote method not implemented.')
  }

  /**
   * getDocuments (multiple)
   *
   * Primary used to get documents that have been selected by page,
   * batch, or cursor.
   *
   * @param documentVersionIds
   * @param locale
   * @returns
   */
  async getDocuments({
    document_version_ids,
    locale = 'all',
  }: {
    document_version_ids: string[]
    locale?: string
  }): Promise<any[]> {
    if (document_version_ids.length === 0) return []

    throw new Error('db-remote method not implemented.')
  }

  /**
   * getDocumentHistory
   *
   * Gets the history of a document version by its logical document ID. This will
   * included any 'soft deleted' documents as well.
   *
   * @param documentId
   * @param collectionId
   * @returns
   */
  async getDocumentHistory({
    collection_id,
    document_id,
    locale = 'all',
    page = 1,
    page_size = 20,
    order = 'updated_at',
    desc = true,
  }: {
    collection_id: string
    document_id: string
    locale?: string
    page?: number
    page_size?: number
    order?: string
    desc?: boolean
    query?: string
  }): Promise<{
    documents: any[]
    meta: {
      total: number
      page: number
      page_size: number
      total_pages: number
      order: string
      desc: boolean
    }
  }> {
    throw new Error('db-remote method not implemented.')
  }

  /**
   * getPublishedVersion
   */
  async getPublishedVersion({
    collection_id,
    document_id,
    status = 'published',
  }: {
    collection_id: string
    document_id: string
    status?: string
  }): Promise<{
    document_version_id: string
    document_id: string
    status: string
    created_at: Date
    updated_at: Date
  } | null> {
    throw new Error('db-remote method not implemented.')
  }
}

/**
 * Factory function
 * @param siteConfig
 * @param db
 * @returns
 */
export function createQueryBuilders(_db: null) {
  return {
    collections: new CollectionQueries(),
    documents: new DocumentQueries(),
  }
}
