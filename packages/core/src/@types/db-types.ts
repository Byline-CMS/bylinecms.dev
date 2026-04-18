import type { CollectionDefinition } from '@byline/core'

/**
 * Read mode for document queries.
 *
 *   - `'any'`       — return the latest version of each document regardless
 *                     of its workflow status (the standard `current_documents`
 *                     view semantics). Default when omitted; used by admin
 *                     UIs that need to surface in-progress drafts.
 *   - `'published'` — return the latest *published* version of each
 *                     document, falling back past newer drafts to the
 *                     previously-published content. A document with no
 *                     published version is invisible in this mode.
 *                     Used by public read consumers (`@byline/client`
 *                     defaults to this).
 */
export type ReadMode = 'any' | 'published'

/**
 * Request-scoped context shared across every read and populate walk in one
 * logical request. Threaded through populate, `afterRead` hooks, and any
 * nested reads the hook itself performs — the visited set and read budget
 * survive across these calls to prevent A→B→A infinite loops.
 *
 * Lives in `@types` (not `services/`) so collection-hook type definitions
 * can reference it without a layer violation. The `createReadContext()`
 * factory stays in `services/populate.ts`.
 */
export interface ReadContext {
  /**
   * Composite keys (`${target_collection_id}:${document_id}`) for every
   * document populate has materialised during this request. Used by the
   * populate walk to skip re-fetching a target it has already expanded
   * (the cycle-stub path).
   */
  visited: Set<string>
  /**
   * Composite keys (`${collection_path}:${document_id}`) for every
   * document whose `afterRead` hook has fired during this request. Used
   * to enforce "each document runs through `afterRead` at most once per
   * logical request" — the rule that forecloses the A→B→A loop when a
   * hook performs its own reads.
   */
  afterReadFired: Set<string>
  /** Monotonic count of document materialisations; compared against `maxReads`. */
  readCount: number
  /** Hard ceiling on materialisations per request. Default 500. */
  maxReads: number
  /** Hard ceiling on populate depth per request. Default 8. */
  maxDepth: number
}

// ---------------------------------------------------------------------------
// Field-level filter and sort descriptors
// ---------------------------------------------------------------------------

/** Operators supported by field-level WHERE clauses. */
export type FieldFilterOperator =
  | '$eq'
  | '$ne'
  | '$gt'
  | '$gte'
  | '$lt'
  | '$lte'
  | '$contains'
  | '$in'
  | '$nin'

/**
 * A single field-level filter, pre-resolved to the correct EAV store table
 * and value column. The client API's `parse-where` module produces these;
 * the DB adapter consumes them to build EXISTS subqueries.
 */
export interface FieldFilter {
  /** The field name as declared in CollectionDefinition (e.g. 'title'). */
  fieldName: string
  /** Which EAV store table holds this field's data (e.g. 'text', 'numeric'). */
  storeType: string
  /** The column within the store table that holds the value (e.g. 'value', 'value_integer'). */
  valueColumn: string
  /** The comparison operator. */
  operator: FieldFilterOperator
  /** The value(s) to compare against. */
  value: string | number | boolean | null | Array<string | number>
}

/**
 * A field-level sort descriptor, pre-resolved to the correct EAV store
 * table and value column. Used for sorting by field values (as opposed to
 * document-level columns like created_at).
 */
export interface FieldSort {
  /** The field name as declared in CollectionDefinition. */
  fieldName: string
  /** Which EAV store table holds this field's data. */
  storeType: string
  /** The column within the store table that holds the sortable value. */
  valueColumn: string
  /** Sort direction. */
  direction: 'asc' | 'desc'
}

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
    /**
     * When updating an existing document, the version ID of the version being
     * replaced. If provided and `locale` is a specific locale (not 'all'),
     * field-value rows for other locales are copied forward from this version
     * into the new one so that per-locale content is not lost.
     */
    previousVersionId?: string
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

export interface ICollectionQueries {
  getAllCollections(): Promise<any[]>
  getCollectionByPath(path: string): Promise<any>
  getCollectionById(id: string): Promise<any>
}

export interface IDocumentQueries {
  getDocumentById(params: {
    collection_id: string
    document_id: string
    locale?: string
    reconstruct?: boolean
    /** See `ReadMode`. Defaults to `'any'`. */
    readMode?: ReadMode
  }): Promise<any | null>

  /**
   * Fetch only the current version's metadata row (no field reconstruction).
   *
   * Use this when the caller only needs `{document_version_id, status,
   * path, ...}` — for example, workflow transitions that read the current
   * status and version ID before mutating. Skipping reconstruction avoids
   * the full 7-way UNION ALL and the meta-row fetch.
   *
   * Returns `null` when the document does not exist (or has been soft-deleted).
   */
  getCurrentVersionMetadata(params: { collection_id: string; document_id: string }): Promise<{
    document_version_id: string
    document_id: string
    collection_id: string
    path: string
    status: string
    created_at: Date
    updated_at: Date
  } | null>

  getDocumentByPath(params: {
    collection_id: string
    path: string
    locale?: string
    reconstruct: boolean
    /** See `ReadMode`. Defaults to `'any'`. */
    readMode?: ReadMode
  }): Promise<any | null>

  getDocumentByVersion(params: { document_version_id: string; locale?: string }): Promise<any>

  getDocumentsByVersionIds(params: {
    document_version_ids: string[]
    locale?: string
  }): Promise<any[]>

  /**
   * Batch-fetch current versions for a list of logical document IDs.
   *
   * Used by the client API's relationship populate pass: `store_relation`
   * rows carry `target_document_id` values (not version IDs), so populate
   * collects those IDs and resolves them to fully reconstructed documents
   * in a single round trip. Supports selective field loading via `fields`.
   *
   * Only returns current (non-soft-deleted) versions. Missing IDs are
   * silently omitted from the result.
   */
  getDocumentsByDocumentIds(params: {
    collection_id: string
    document_ids: string[]
    locale?: string
    fields?: string[]
    /** See `ReadMode`. Defaults to `'any'`. */
    readMode?: ReadMode
  }): Promise<any[]>

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
   * Return the set of document IDs (from the provided list) that have at
   * least one version with the given status. Used to efficiently annotate
   * list views with a "published version exists" flag.
   */
  getPublishedDocumentIds(params: {
    collection_id: string
    document_ids: string[]
    status?: string
  }): Promise<Set<string>>

  /**
   * Return a count of current documents grouped by status for a given
   * collection. Uses the `current_documents` view so each logical document
   * is counted once at its latest version.
   */
  getDocumentCountsByStatus(params: {
    collection_id: string
  }): Promise<Array<{ status: string; count: number }>>

  /**
   * Execute a filtered, sorted, paginated query against current documents
   * using field-level EAV filters and optional field-level sorting.
   *
   * Used by the client API's query builder (Phase 2). Each FieldFilter
   * becomes an EXISTS subquery against the appropriate store table; a
   * FieldSort becomes a LATERAL JOIN to pull the sort value into the
   * outer query.
   */
  findDocuments(params: {
    collection_id: string
    filters?: FieldFilter[]
    /**
     * Exact-match filter on the current version's `status` column. Used by
     * admin UIs that filter the list view by a specific status ("show me
     * all drafts"). Distinct from `readMode`, which selects the *source
     * view* — see `ReadMode`.
     */
    status?: string
    pathFilter?: { operator: FieldFilterOperator; value: string }
    /** Text search across the collection's configured search fields. */
    query?: string
    sort?: FieldSort
    /** Document-level sort column (created_at, updated_at, path). Used when sort is not a field-level sort. */
    orderBy?: string
    orderDirection?: 'asc' | 'desc'
    locale?: string
    page?: number
    pageSize?: number
    fields?: string[]
    /** See `ReadMode`. Defaults to `'any'`. */
    readMode?: ReadMode
  }): Promise<{
    documents: any[]
    total: number
  }>
}
