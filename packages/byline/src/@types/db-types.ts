import type { CollectionDefinition } from '@byline/core'

export interface IDbAdapter {
  commands: {
    collections: ICollectionCommands
    documents: IDocumentCommands
  }
  queries: {
    collections: ICollectionQueries
    documents: IDocumentQueries
  }
}

export interface ICollectionCommands {
  create(path: string, config: CollectionDefinition): Promise<any>
  delete(id: string): Promise<any>
}

export interface IDocumentCommands {
  createDocumentVersion(params: {
    documentId?: string
    collectionId: string
    collectionConfig: CollectionDefinition
    action: string
    documentData: any
    path: string
    locale?: string
    status?: string
    createdBy?: string
  }): Promise<{ document: any; fieldCount: number }>

  /**
   * Mutate the status on an existing document version row.
   *
   * This is the one case where we UPDATE a version in-place rather than
   * creating a new version — status is lifecycle metadata, not content.
   */
  setDocumentStatus(params: { document_version_id: string; status: string }): Promise<void>
}

// From: /apps/dashboard/server/storage/storage-queries.ts

export interface ICollectionQueries {
  getAllCollections(): Promise<any[]>
  getCollectionByPath(path: string): Promise<any>
  getCollectionById(id: string): Promise<any>
}

export interface IDocumentQueries {
  getAllDocuments(params: { collection_id: string; locale?: string }): Promise<any[]>

  getDocumentsByBatch(params: {
    collection_id: string
    batch_size?: number
    locale?: string
  }): Promise<any[]>

  getDocumentsByPage(params: {
    collection_id: string
    locale?: string
    page?: number
    page_size?: number
    order?: string
    desc?: boolean
    query?: string
    status?: string
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
  }>

  getDocumentById(params: {
    collection_id: string
    document_id: string
    locale?: string
    reconstruct?: boolean
  }): Promise<any | null>

  getDocumentByPath(params: {
    collection_id: string
    path: string
    locale?: string
    reconstruct: boolean
  }): Promise<any>

  getDocumentByVersion(params: { document_version_id: string; locale?: string }): Promise<any>

  getDocuments(params: { document_version_ids: string[]; locale?: string }): Promise<any[]>

  getDocumentHistory(params: {
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
  }>
}
