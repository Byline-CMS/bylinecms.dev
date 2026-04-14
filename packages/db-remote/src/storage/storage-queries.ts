/**
 * This Source Code is subject to the terms of the Mozilla Public
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
  // @ts-expect-error
  async getAllCollections() {
    throw new Error('db-remote method not implemented.')
  }

  async getCollectionByPath(_path: string) {
    throw new Error('db-remote method not implemented.')
  }

  async getCollectionById(_id: string) {
    throw new Error('db-remote method not implemented.')
  }
}

/**
 * DocumentQueries
 */
export class DocumentQueries implements IDocumentQueries {
  async getDocumentById(_params: {
    collection_id: string
    document_id: string
    locale?: string
    reconstruct?: boolean
  }) {
    throw new Error('db-remote method not implemented.')
  }

  async getCurrentVersionMetadata(_params: {
    collection_id: string
    document_id: string
  }): Promise<{
    document_version_id: string
    document_id: string
    collection_id: string
    path: string
    status: string
    created_at: Date
    updated_at: Date
  } | null> {
    throw new Error('db-remote method not implemented.')
  }

  async getDocumentByPath(_params: {
    collection_id: string
    path: string
    locale?: string
    reconstruct: boolean
  }) {
    throw new Error('db-remote method not implemented.')
  }

  async getDocumentByVersion(_params: {
    document_version_id: string
    locale?: string
  }): Promise<any> {
    throw new Error('db-remote method not implemented.')
  }

  async getDocumentsByVersionIds(_params: {
    document_version_ids: string[]
    locale?: string
  }): Promise<any[]> {
    throw new Error('db-remote method not implemented.')
  }

  async getDocumentsByDocumentIds(_params: {
    collection_id: string
    document_ids: string[]
    locale?: string
    fields?: string[]
  }): Promise<any[]> {
    throw new Error('db-remote method not implemented.')
  }

  async getDocumentHistory(_params: {
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

  async getPublishedVersion(_params: {
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

  async getPublishedDocumentIds(_params: {
    collection_id: string
    document_ids: string[]
    status?: string
  }): Promise<Set<string>> {
    return new Set()
  }

  async getDocumentCountsByStatus(_params: {
    collection_id: string
  }): Promise<Array<{ status: string; count: number }>> {
    return []
  }

  async findDocuments(_params: {
    collection_id: string
    locale?: string
    page?: number
    pageSize?: number
  }): Promise<{ documents: any[]; total: number }> {
    throw new Error('db-remote method not implemented.')
  }
}

/**
 * Factory function
 */
export function createQueryBuilders(_db: null) {
  return {
    collections: new CollectionQueries(),
    documents: new DocumentQueries(),
  }
}
