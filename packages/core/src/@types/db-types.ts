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

  /**
   * Archive ALL versions of a document that currently have a given status.
   *
   * Optionally exclude a specific version (e.g. the one being published right
   * now) so we don't accidentally archive it.
   *
   * Returns the number of rows updated.
   */
  archivePublishedVersions(params: {
    document_id: string
    currentStatus?: string
    excludeVersionId?: string
  }): Promise<number>

  /**
   * Soft-delete a document by setting `is_deleted = true` on ALL of its
   * versions. The `current_documents` view automatically filters these out,
   * so the document disappears from listings without physically removing data.
   *
   * Returns the number of version rows marked as deleted.
   */
  softDeleteDocument(params: { document_id: string }): Promise<number>
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

  /**
   * Find the latest version of a document that has a specific status.
   *
   * This queries `document_versions` directly (not the current_documents view)
   * so it can find a published version even when a newer draft exists.
   *
   * Returns minimal version metadata (not reconstructed content).
   */
  getPublishedVersion(params: {
    collection_id: string
    document_id: string
    status?: string
  }): Promise<{
    document_version_id: string
    document_id: string
    status: string
    created_at: Date
    updated_at: Date
  } | null>

  /**
   * Return a count of current documents grouped by status for a given
   * collection. Uses the `current_documents` view so each logical document
   * is counted once at its latest version.
   */
  getDocumentCountsByStatus(params: {
    collection_id: string
  }): Promise<Array<{ status: string; count: number }>>
}
