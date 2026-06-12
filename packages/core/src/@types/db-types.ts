import type { RequestContext } from '@byline/auth'
import type { CollectionDefinition } from '@byline/core'

import type { QueryPredicate } from './query-predicate.js'

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
 * What a read does when the requested content locale is missing (the value of
 * the `onMissingLocale` read option).
 *
 *   - `'empty'`    — no field-level fallback. Restore the requested locale
 *                    exactly, leaving untranslated localized fields empty. The
 *                    raw per-locale view the admin editor needs (empty =
 *                    "not translated yet"). The document is always returned.
 *   - `'fallback'` — fall back through the locale chain to the default content
 *                    locale, restoring the whole document in one effective
 *                    locale (never mixing). A detail read still returns the
 *                    document; a list read still includes it. The
 *                    `@byline/client` default — public consumers "just work".
 *   - `'omit'`     — only surface documents available in the requested locale.
 *                    A detail read returns `null` (→ 404) when the requested
 *                    locale is unavailable; a list read excludes such documents.
 *                    Available documents restore the requested locale exactly.
 *                    Backed by the `byline_document_version_locales` ledger.
 *
 * At the adapter layer an omitted value behaves as `'empty'` (exact-match, the
 * safe default for internal/direct reads); `@byline/client` defaults it to
 * `'fallback'` for application reads. Availability follows path-coverage against
 * the default content locale; a document with no localized content is available
 * in every locale. See `docs/I18N.md`.
 */
export type MissingLocalePolicy = 'empty' | 'fallback' | 'omit'

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
  /**
   * Per-request memoisation of `beforeRead` hook results, keyed by
   * `collectionPath`. Populate fans out across many source documents and
   * many target-collection batches; without a cache, an async hook
   * (e.g. resolving the actor's tenant id) would re-run on every batch.
   * Keyed by collection path because the actor is invariant for the
   * lifetime of one `ReadContext`. `null` records "hook ran and returned
   * void" (i.e. no scoping applies); absence records "hook has not been
   * run yet for this collection".
   */
  beforeReadCache: Map<string, QueryPredicate | null>
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
  kind: 'field'
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
 * A cross-collection relation filter. Matches documents whose relation
 * field `fieldName` points at a target document that itself satisfies
 * `nested` filters. Produced by `parse-where` when a where value under
 * a relation field is a plain object of target-field predicates, e.g.
 * `{ category: { path: 'news' } }`. The adapter compiles this into a
 * nested EXISTS joining `store_relation` to the target collection's
 * current-documents view and recursing into `nested` against the
 * target's own EAV stores.
 *
 * The nesting is finite — user-written `where` clauses cannot cycle
 * because the structure itself is finite — so no cycle guard is needed
 * on this path (unlike populate, which traverses implicitly).
 */
export interface RelationFilter {
  kind: 'relation'
  /** The relation field name on the source collection (e.g. 'category'). */
  fieldName: string
  /** The target collection's id (resolved at parse time). */
  targetCollectionId: string
  /** Filters applied to the target document. Recursive. */
  nested: DocumentFilter[]
}

/**
 * A boolean combinator group. Wraps a list of child filters with explicit
 * AND or OR semantics; nests freely. Produced by `parse-where` from
 * `$and` / `$or` keys in the source `QueryPredicate`. The adapter compiles
 * each child into its existing SQL form (field EXISTS, relation EXISTS,
 * or another combinator group) and joins them with the matching SQL
 * operator inside parentheses.
 *
 * Top-level `$and` is structurally redundant with the implicit AND across
 * `DocumentFilter[]` and the parser flattens it for simplicity; the
 * combinator only earns its keep when nested inside `$or` (or vice versa).
 */
export interface CombinatorFilter {
  kind: 'and' | 'or'
  children: DocumentFilter[]
}

/**
 * A predicate over a document-version column (`status`, `path`, `id`).
 * Distinct from `FieldFilter` — these columns live on `document_versions`
 * itself (or the current-documents view), not on the EAV stores, so they
 * compile to a direct outer-scope column comparison rather than an `EXISTS`
 * subquery.
 *
 * Produced by `parse-where` for two reasons:
 *
 *   - `status` / `path` appearing *inside* a combinator (`$or` / `$and`
 *     child) or inside a relation sub-clause. At the top level the same
 *     keys are intercepted as `ParsedWhere.status` / `ParsedWhere.pathFilter`
 *     because they map to direct adapter parameters there; inside a
 *     combinator that mapping no longer makes sense (you can't OR-combine
 *     with the outer scalar parameter), so they downshift to this filter.
 *
 *   - `id` at *any* scope. Unlike `status` (single equality, used in many
 *     non-filter call sites) and `path` (needs the `pathProjection` join
 *     against `byline_document_paths`), `id` is a plain column on the
 *     current-documents view comparable directly at every scope. Skipping
 *     a top-level scalar form keeps the surface area small.
 *
 * `value` is widened beyond `string | null` so the `$in` / `$nin` operators
 * (the headline use case for `id`) can carry array operands.
 */
export interface DocumentColumnFilter {
  kind: 'docColumn'
  column: 'status' | 'path' | 'id'
  operator: FieldFilterOperator
  value: string | number | boolean | null | Array<string | number>
}

/**
 * Any filter that can appear in a `findDocuments` call — a direct field
 * predicate (`FieldFilter`), a cross-collection hop through a relation
 * (`RelationFilter`), a nested boolean combinator (`CombinatorFilter`),
 * or a document-version column comparison (`DocumentColumnFilter`).
 */
export type DocumentFilter = FieldFilter | RelationFilter | CombinatorFilter | DocumentColumnFilter

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
    counters: ICounterCommands
  }
  queries: {
    collections: ICollectionQueries
    documents: IDocumentQueries
  }
  /**
   * Optional maintenance: stamp `source_locale` (the per-document content
   * anchor) on documents created before the column existed, setting NULL rows
   * to the adapter's configured default content locale. Called idempotently at
   * boot by `initBylineCore` so in-place upgrades self-heal without a manual
   * step or a migrate-ordering constraint — a no-op (zero rows) once every
   * document is stamped. Optional so adapters that don't model `source_locale`
   * need not implement it. See docs/I18N.md.
   */
  backfillSourceLocales?: () => Promise<{ rowsUpdated: number }>
}

/**
 * Adapter capability for the shared-pool counter mechanism backing the
 * `counter` field type. See `packages/core/src/@types/field-types.ts`
 * (CounterField) for the field-level contract and `docs/COLLECTIONS.md`
 * (Counter fields) for the conceptual overview.
 *
 * Both methods are keyed by the developer-facing `groupName` (the value
 * of `CounterField.group`). The adapter is responsible for translating
 * that into whatever backing primitive it uses (a Postgres SEQUENCE for
 * the Postgres adapter) and for keeping the `byline_counter_groups`
 * registry table in sync.
 */
export interface ICounterCommands {
  /**
   * Idempotently register a counter group and ensure its backing
   * sequence exists. Called once per discovered group at boot by the
   * collection-bootstrap layer (`@byline/core`). Safe to call
   * concurrently across multiple booting processes — implementations
   * must use `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` semantics so
   * two processes racing on the same group leave the system with
   * exactly one sequence and one registry row.
   *
   * Returns the resolved sequence name so callers (tests, doctor
   * tooling) can inspect what was created without re-deriving it.
   */
  ensureCounterGroup(groupName: string): Promise<{ groupName: string; sequenceName: string }>

  /**
   * Atomically allocate the next value from the named group's
   * sequence. Called on every document create that includes one or
   * more `counter` fields (see assignCounterValues in
   * document-lifecycle). Throws if the group has not been registered
   * via `ensureCounterGroup` — the lifecycle layer is expected to
   * surface that as a configuration error, not silently retry.
   *
   * Gaps are expected: sequences leak on rolled-back transactions
   * and deletes. The facet-URL use case does not require gapless IDs.
   */
  nextCounterValue(groupName: string): Promise<number>
}

export interface ICollectionCommands {
  /**
   * Insert a new collection row. `opts.version` and `opts.schemaHash` are
   * used by the startup bootstrap to anchor initial values; omitted by
   * legacy seed scripts that rely on the DB-level `version` default.
   */
  create(
    path: string,
    config: CollectionDefinition,
    opts?: { version?: number; schemaHash?: string }
  ): Promise<any>
  /**
   * Partial update for the collection row. Only fields supplied in `patch`
   * are written — other columns are left untouched. Used by the startup
   * bootstrap to record schema version bumps alongside a refreshed
   * config/hash.
   */
  update(
    id: string,
    patch: {
      config?: CollectionDefinition
      version?: number
      schemaHash?: string
    }
  ): Promise<any>
  delete(id: string): Promise<any>
}

export interface IDocumentCommands {
  createDocumentVersion(params: {
    documentId?: string
    collectionId: string
    /**
     * The collection's schema version at the time of this write. Stamped
     * onto the `documentVersions` row so that Phase-2 in-memory migration
     * can later resolve each document against the shape it was authored
     * under. Resolved by the caller from the core registry.
     */
    collectionVersion: number
    collectionConfig: CollectionDefinition
    action: string
    documentData: any
    /**
     * Optional. When provided, the adapter upserts a row into
     * `byline_document_paths` keyed by `(document_id, defaultContentLocale)`.
     * When omitted, no path write occurs — the lifecycle uses this to
     * skip path writes during translation (non-default-locale) saves.
     * The unique constraint on `(collection_id, locale, path)` may
     * surface as `ERR_PATH_CONFLICT` from the lifecycle layer.
     */
    path?: string
    /**
     * Optional. When provided, the adapter replaces the document's rows in
     * `byline_document_available_locales` (document-grain) wholesale — the
     * editorial advertised-locale set. `undefined` leaves the existing set
     * untouched (sticky across versions, like `path`); `[]` clears it. The
     * locale values are the advertised content locales themselves, not the
     * write locale. See `docs/I18N.md`.
     */
    availableLocales?: string[]
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
    /**
     * Fractional-index order key written onto the new `byline_documents` row.
     * Only set on the initial create (when `documentId` is undefined) for
     * collections with `orderable: true`. Ignored on subsequent versions of
     * an existing document — order is admin metadata on the logical document,
     * not per-version content. See docs/COLLECTIONS.md (Orderable collections).
     */
    orderKey?: string
  }): Promise<{ document: any; fieldCount: number }>

  /**
   * Standalone, non-versioned write of a document's URL path
   * (`byline_document_paths`). Edits the document-grain, sticky path row
   * in-place **without** minting a new version or touching workflow status —
   * the change is immediate and applies across every version. Backs the admin
   * path widget's direct-write Save. The unique constraint on
   * `(collection_id, locale, path)` may surface as `ERR_PATH_CONFLICT` from the
   * lifecycle layer. See `docs/I18N.md`.
   */
  updateDocumentPath(params: {
    documentId: string
    collectionId: string
    locale: string
    path: string
  }): Promise<void>

  /**
   * Standalone, non-versioned write of a document's editorial advertised-locale
   * set (`byline_document_available_locales`). Replaces the document-grain set
   * wholesale **without** minting a new version or touching workflow status —
   * the change is immediate and applies across every version. `[]` clears it.
   * Backs the admin available-locales widget's direct-write Save. See
   * `docs/I18N.md`.
   */
  setDocumentAvailableLocales(params: {
    documentId: string
    collectionId: string
    availableLocales: string[]
  }): Promise<void>

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

  /**
   * Remove one content locale's data from a document by writing a new
   * immutable version that carries forward every store row except the target
   * locale's (the `'all'` rows and all other locales are kept). The prior
   * version still holds the deleted locale, so the operation is recoverable.
   *
   * `status` is the new version's status (the lifecycle service passes the
   * workflow default — a fresh draft). Returns the new and previous version
   * ids, or `null` when the document has no current version.
   */
  deleteDocumentLocale(params: {
    documentId: string
    locale: string
    status?: string
    /** Acting user id for the version audit trail (`created_by`). See docs/AUDIT.md. */
    createdBy?: string
  }): Promise<{ newVersionId: string; previousVersionId: string } | null>

  /**
   * Write the fractional-index `order_key` on a single `byline_documents`
   * row. Used by the reorder server fn for `orderable: true` collections.
   *
   * This is a single-column metadata update — it does NOT create a new
   * document version and does NOT touch `documentVersions`. `updated_at`
   * on the row is refreshed so list-view caches can invalidate cleanly.
   */
  setOrderKey(params: { document_id: string; order_key: string }): Promise<void>
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
    /**
     * Additional WHERE-clause predicates ANDed onto the query. Used by
     * `CollectionHandle` to apply `beforeRead`-hook scoping; when the
     * predicate excludes the row, the method returns `null` (the same
     * shape as "document does not exist").
     */
    filters?: DocumentFilter[]
    /**
     * Request-scoped auth context. Adapters thread it through to
     * `assertActorCanPerform` for ability assertion and to `beforeRead`
     * hooks for query scoping. See docs/AUTHN-AUTHZ.md.
     */
    requestContext?: RequestContext
    /**
     * "Best-effort" reconstruction. When `true`, schema-mismatch warnings
     * (orphan rows, unrecognised block paths, etc. — typically the result
     * of editing a `CollectionDefinition` while older documents linger in
     * the store) are surfaced on the returned object as `restoreWarnings`
     * instead of being thrown as `ERR_DATABASE`. Reserved for the admin
     * edit path; public reads should leave this `false` so partial data
     * never silently leaks into a live site.
     */
    lenient?: boolean
    /** See `MissingLocalePolicy`. `'omit'` returns `null` when the document
     *  is not available in the requested locale. Omitted ⇒ `'empty'`. */
    onMissingLocale?: MissingLocalePolicy
  }): Promise<any | null>

  /**
   * Fetch only the current version's metadata row (no field reconstruction).
   *
   * Use this when the caller only needs `{document_version_id, status,
   * created_at, updated_at}` — for example, workflow transitions that read
   * the current status and version ID before mutating. Skipping
   * reconstruction avoids the full 7-way UNION ALL and the meta-row fetch.
   *
   * `path` is intentionally not returned: callers that need it should
   * use `getDocumentById` (which projects the locale-resolved path).
   *
   * Returns `null` when the document does not exist (or has been soft-deleted).
   */
  getCurrentVersionMetadata(params: { collection_id: string; document_id: string }): Promise<{
    document_version_id: string
    document_id: string
    collection_id: string
    status: string
    created_at: Date
    updated_at: Date
  } | null>

  /**
   * Resolve a document's canonical (source-locale) routing path.
   *
   * Returns the `byline_document_paths` row for the document under its own
   * `source_locale` anchor (falling back to the configured default content
   * locale for rows predating `source_locale`). Narrow by design — used by
   * the lifecycle to populate `path` on the status-change / unpublish hook
   * contexts without widening `getCurrentVersionMetadata`.
   *
   * Returns `null` when the document has no path row (or does not exist).
   *
   * Source-locale only: this resolves the single canonical slug, which is the
   * only path row a document has today. When per-locale paths land (see
   * docs/DOCUMENT-PATHS.md → "Phase — per-locale paths"), the write-side hook
   * contexts that consume this must be enriched to carry the locale each path
   * was derived under (or the full `locale → path` set) — a single canonical
   * `path` is no longer sufficient for per-localised-URL cache/CDN purges.
   */
  getCurrentPath(params: { collection_id: string; document_id: string }): Promise<string | null>

  getDocumentByPath(params: {
    collection_id: string
    path: string
    locale?: string
    reconstruct: boolean
    /** See `ReadMode`. Defaults to `'any'`. */
    readMode?: ReadMode
    /** See `getDocumentById.filters`. */
    filters?: DocumentFilter[]
    /** See `getDocumentById.requestContext`. */
    requestContext?: RequestContext
    /** See `MissingLocalePolicy`. `'omit'` returns `null` when the document
     *  is not available in the requested locale. Omitted ⇒ `'empty'`. */
    onMissingLocale?: MissingLocalePolicy
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
    /** See `getDocumentById.filters`. Used by populate to apply each target
     *  collection's `beforeRead` predicate to its batch fetch. */
    filters?: DocumentFilter[]
    /** See `getDocumentById.requestContext`. */
    requestContext?: RequestContext
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
    /** See `getDocumentById.filters`. Used by `CollectionHandle.countByStatus`
     *  to apply `beforeRead`-hook scoping so per-status counts reflect only
     *  the rows the actor can see. */
    filters?: DocumentFilter[]
    /** See `getDocumentById.requestContext`. */
    requestContext?: RequestContext
  }): Promise<Array<{ status: string; count: number }>>

  /**
   * Execute a filtered, sorted, paginated query against current documents
   * using field-level EAV filters and optional field-level sorting.
   *
   * Used by the client API's query builder (Phase 2). Each FieldFilter
   * becomes an EXISTS subquery against the appropriate store table; a
   * RelationFilter becomes a nested EXISTS that joins through
   * `store_relation` to the target collection's current-documents view
   * and recurses into its own filters. A FieldSort becomes a LATERAL
   * JOIN to pull the sort value into the outer query.
   */
  findDocuments(params: {
    collection_id: string
    filters?: DocumentFilter[]
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
    /** Document-level sort column (`created_at`, `updated_at`). Used when `sort` is not a field-level sort. */
    orderBy?: string
    orderDirection?: 'asc' | 'desc'
    locale?: string
    page?: number
    pageSize?: number
    fields?: string[]
    /** See `ReadMode`. Defaults to `'any'`. */
    readMode?: ReadMode
    /** See `getDocumentById.requestContext`. */
    requestContext?: RequestContext
    /** See `MissingLocalePolicy`. `'omit'` excludes documents not available
     *  in the requested locale (filtered at the SQL layer so pagination stays
     *  correct). Omitted ⇒ `'empty'`. */
    onMissingLocale?: MissingLocalePolicy
  }): Promise<{
    documents: any[]
    total: number
  }>

  /**
   * Return the largest `order_key` currently in use for the given collection,
   * or `null` if there are no keyed rows yet. Used at create-time on
   * `orderable: true` collections to append the new row to the end.
   *
   * Ignores `is_deleted` rows (soft-deleted documents) and rows with a
   * NULL `order_key`. If every document in the collection is unkeyed,
   * returns `null` and the caller seeds the first key from scratch.
   */
  getLastOrderKey(params: { collection_id: string }): Promise<string | null>

  /**
   * Resolve the `order_key` values immediately bracketing a target gap.
   *
   * Called by the reorder server fn. The caller passes the IDs of the
   * documents the dragged row should land **between** (`before` is the doc
   * that should come immediately before, `after` immediately after). Either
   * can be `null` to mean "the end" (`after: null`) or "the start"
   * (`before: null`); both null is "append to a collection with no rows."
   *
   * Resolving keys in one query (instead of two round-trips that read
   * each neighbor separately) keeps the read consistent with the moment
   * the next-key computation runs, so concurrent reorders don't race into
   * a degenerate gap.
   */
  getNeighborOrderKeys(params: {
    collection_id: string
    before_document_id: string | null
    after_document_id: string | null
  }): Promise<{ left: string | null; right: string | null }>

  /**
   * Return every document in the collection in its canonical list-view
   * order: `order_key ASC NULLS LAST, created_at DESC`. Keyed rows come
   * first (in key order), then any unkeyed rows fall through to newest-
   * first by creation time — exactly what the editor sees in the list
   * view today.
   *
   * Used by the reorder server fn to lazily backfill unkeyed rows AND to
   * detect / recover from pathological key state (duplicates, descending
   * runs) by re-keying the entire collection in displayed order. Collection
   * sizes for `orderable` use cases are small by design (bios, FAQs,
   * sections), so the full read is cheap.
   */
  getCanonicalDocumentOrder(params: {
    collection_id: string
  }): Promise<Array<{ id: string; order_key: string | null }>>
}
