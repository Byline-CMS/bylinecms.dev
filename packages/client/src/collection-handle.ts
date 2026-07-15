/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { RequestContext } from '@byline/auth'
import type {
  AuditLogPage,
  ChangeStatusResult,
  CollectionDefinition,
  CreateDocumentResult,
  DeleteDocumentResult,
  DocumentFilter,
  DocumentLifecycleContext,
  PopulateSpec,
  ReadContext,
  ReadMode,
  RestoreVersionResult,
  UnpublishResult,
  UpdateDocumentResult,
} from '@byline/core'
import {
  applyAfterRead,
  applyBeforeRead,
  assertActorCanPerform,
  buildSearchDocument,
  changeDocumentStatus,
  createDocument,
  createReadContext,
  createRichTextDocumentReader,
  deleteDocument,
  ERR_VALIDATION,
  mergePredicates,
  type PopulateMap,
  parsePredicateFilters,
  parseSort,
  parseWhere,
  placeTreeNode as placeTreeNodeLifecycle,
  populateDocuments,
  populateRichTextFields,
  removeFromTree as removeFromTreeLifecycle,
  resolveIdentityField,
  restoreDocumentVersion,
  unpublishDocument,
  updateDocument,
} from '@byline/core'

import { resolveReadRequestContext } from './read-context.js'
import { shapeDocument, shapePopulatedInPlace } from './response.js'
import { finalizeSearchHits } from './search.js'
import type { BylineClient } from './client.js'
import type {
  AuditLogOptions,
  ClientDocument,
  ClientSearchResults,
  CollectionSearchOptions,
  CreateOptions,
  FindByIdOptions,
  FindByPathOptions,
  FindByVersionOptions,
  FindOneOptions,
  FindOptions,
  FindResult,
  GetAncestorsOptions,
  GetSubtreeOptions,
  GetTreeParentOptions,
  HistoryOptions,
  PlaceTreeNodeOptions,
  ReindexResult,
  RemoveFromTreeOptions,
  TreeNode,
  TreeParentResult,
  UpdateOptions,
} from './types.js'

/**
 * A handle scoped to a single collection. Provides read (and eventually write)
 * operations against that collection's documents.
 *
 * Created via `client.collection('posts')`.
 */
export class CollectionHandle<TFields extends Record<string, any> = Record<string, any>> {
  private client: BylineClient<any>
  private definition: CollectionDefinition

  constructor(client: BylineClient<any>, definition: CollectionDefinition) {
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
  async find<F = TFields>(options: FindOptions<F> = {}): Promise<FindResult<F>> {
    const readMode = resolveReadMode(options.status)
    const readCtx = options._readContext ?? createReadContext()
    const requestContext = await this.resolveAndAssertRead(readMode, readCtx)
    const collectionId = await this.client.resolveCollectionId(this.definition.path)
    const {
      where,
      select,
      sort,
      locale = this.client.defaultLocale,
      page = 1,
      pageSize = 20,
    } = options
    const hookPredicate = await this.resolveBeforeReadPredicate(
      requestContext,
      readCtx,
      options._bypassBeforeRead
    )
    const merged = mergePredicates(hookPredicate, where)
    const parsedWhere = await parseWhere(merged, this.definition, {
      collections: this.client.collections,
      resolveCollectionId: (path) => this.client.resolveCollectionId(path),
      logger: this.client.logger,
    })
    const parsedSort = parseSort(sort, this.definition)

    const result = await this.client.db.queries.documents.findDocuments({
      collection_id: collectionId,
      filters: parsedWhere.filters,
      status: parsedWhere.status,
      pathFilter: parsedWhere.pathFilter,
      query: parsedWhere.query,
      sort: parsedSort.fieldSort,
      orderBy: parsedSort.orderBy,
      orderDirection: parsedSort.orderDirection,
      locale,
      page,
      pageSize,
      fields: select as string[] | undefined,
      readMode,
      onMissingLocale: options.onMissingLocale ?? 'fallback',
    })

    await this.populateIfRequested(
      collectionId,
      result.documents,
      locale,
      readMode,
      requestContext,
      {
        ...options,
        _readContext: readCtx,
      }
    )

    await this.finishReadDocuments(
      result.documents,
      readCtx,
      requestContext,
      locale,
      readMode,
      options._bypassBeforeRead,
      select as string[] | undefined,
      readMaterialization(options.populate, options.depth)
    )

    return {
      docs: result.documents.map((d) => this.shapeWithPopulated<F>(d)),
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
  async findOne<F = TFields>(options: FindOneOptions<F> = {}): Promise<ClientDocument<F> | null> {
    const result = await this.find<F>({
      where: options.where,
      select: options.select,
      locale: options.locale,
      page: 1,
      pageSize: 1,
      populate: options.populate,
      depth: options.depth,
      status: options.status,
      onMissingLocale: options.onMissingLocale,
      _readContext: options._readContext,
      _bypassBeforeRead: options._bypassBeforeRead,
    })
    return result.docs[0] ?? null
  }

  /**
   * Ranked full-text search scoped to this collection, delegated to the
   * registered `SearchProvider` (see `ServerConfig.search`). Returns the
   * lightweight hit tier — `title`, `path`, `score`, and matched-snippet
   * `highlights` — enough to render a results list without hydration; fetch
   * the hit ids via `findById` when a richer item is needed.
   *
   * Asserts the collection `read` ability first (same gate as the other
   * reads), and defaults `status` to `'published'`, so a public viewer only
   * sees published content — which is also all the index holds, since
   * indexing is published-only.
   *
   * **Row-level authorization** — "rank in the provider, authorise in core":
   * when the collection configures a `beforeRead` hook, the provider's
   * candidate hits are re-resolved through the normal read path (the same
   * predicate merge + SQL compile every other read uses) and hits whose
   * document doesn't survive the scoping are dropped. Collections without a
   * hook skip the second query entirely. `hydrate: true` batch-reads the
   * hits into shaped `ClientDocument`s in the same query (authorisation
   * comes free) and attaches them as `hit.document`. Two consequences to be
   * aware of:
   *
   *   - under row scoping, `total` is the authorized hit count for this page
   *     and facets are omitted rather than leaking provider-wide aggregates.
   *   - a page of hits can come back shorter than `limit` when candidates
   *     are dropped; paginate on `offset`, not on received length.
   *
   * `_bypassBeforeRead: true` is the same system-operation escape hatch the
   * read methods take.
   *
   * Throws `ERR_VALIDATION` when no provider is registered.
   */
  async search(options: CollectionSearchOptions): Promise<ClientSearchResults> {
    const readMode = resolveReadMode(options.status)
    const readCtx = createReadContext()
    const requestContext = await this.resolveAndAssertRead(readMode, readCtx)
    const aggregateRestricted =
      !options._bypassBeforeRead &&
      (await this.resolveBeforeReadPredicate(requestContext, readCtx, undefined)) != null
    const provider = this.client.searchProvider
    if (provider == null) {
      throw ERR_VALIDATION({
        message:
          'No search provider is registered. Register one on ServerConfig.search — ' +
          'see `@byline/search-postgres` → `postgresSearch()` for the built-in driver.',
      })
    }
    const results = await provider.search({
      query: options.query,
      collectionPath: this.definition.path,
      locale: options.locale ?? this.client.defaultLocale,
      status: readMode,
      where: options.where,
      facets: options.facets,
      limit: options.limit,
      offset: options.offset,
    })

    // Row-level authorization (+ optional hydration) — the shared finishing
    // pipeline the zone entry point uses too. Collections without a
    // beforeRead predicate and no hydrate request pass through untouched.
    const hits = await finalizeSearchHits({
      client: this.client,
      requestContext,
      hits: results.hits,
      locale: options.locale,
      status: options.status,
      hydrate: options.hydrate,
      bypassBeforeRead: options._bypassBeforeRead,
      readContext: readCtx,
    })
    return aggregateRestricted
      ? { hits, total: hits.length }
      : { hits, total: results.total, facets: results.facets }
  }

  // -------------------------------------------------------------------------
  // Search index maintenance
  //
  // `indexDocument` / `removeFromIndex` are the canonical per-document sync the
  // collection lifecycle hooks call; `reindex` is the bulk rebuild (backfill /
  // config change / driver swap). All are no-ops when the collection doesn't
  // opt into search or no provider is registered. System operations — reads use
  // `_bypassBeforeRead` so the index reflects every published document.
  // -------------------------------------------------------------------------

  /**
   * Re-sync one document into the search index across every content locale.
   * Reads the document's *published* view per locale (`onMissingLocale: 'omit'`)
   * and `upsert`s where present, `remove`s where absent — so publish, unpublish,
   * draft-over-published, and plain edits all converge on the same idempotent
   * path. The index always mirrors what a public reader can see.
   */
  async indexDocument(documentId: string): Promise<void> {
    const provider = this.client.searchProvider
    if (provider == null || this.definition.search == null) return

    const populate = this.buildSearchFacetPopulateMap()
    for (const locale of this.client.contentLocales) {
      const view = await this.findById(documentId, {
        locale,
        status: 'published',
        onMissingLocale: 'omit',
        populate,
        _bypassBeforeRead: true,
      })
      if (view == null) {
        await provider.remove({ collectionPath: this.definition.path, documentId, locale })
        continue
      }
      await provider.upsert(
        buildSearchDocument(
          {
            documentId: view.id,
            locale,
            status: view.status,
            path: view.path,
            fields: view.fields as Record<string, unknown>,
            updatedAt: view.updatedAt,
          },
          this.definition,
          {
            locale,
            richTextToText: this.client.richTextToText,
            resolveTargetDefinition: (path) =>
              this.client.collections.find((c) => c.path === path) ?? null,
          }
        )
      )
    }
  }

  /** Remove one document from the search index entirely (all locales). */
  async removeFromIndex(documentId: string): Promise<void> {
    const provider = this.client.searchProvider
    if (provider == null) return
    await provider.remove({ collectionPath: this.definition.path, documentId })
  }

  /**
   * Rebuild this collection's entire search index from its published
   * documents. Clears the existing slice (dropping orphans for deleted docs),
   * then walks every published document (paginated) and re-indexes it. Used for
   * first-time backfill, after a `search` config change, or a driver swap.
   *
   * Asserts the collection `reindex` ability. No-op (returns zero counts) when
   * the collection doesn't opt into search or no provider is registered.
   */
  async reindex(): Promise<ReindexResult> {
    const requestContext = await this.client.resolveRequestContext()
    assertActorCanPerform(requestContext, this.definition.path, 'reindex')

    const provider = this.client.searchProvider
    const result: ReindexResult = { collectionPath: this.definition.path, documents: 0, indexed: 0 }
    if (provider == null || this.definition.search == null) return result

    // Clear the slice so deleted documents don't leave orphan rows.
    await provider.reindex?.({ collectionPath: this.definition.path })

    const pageSize = 100
    let page = 1
    for (;;) {
      const batch = await this.find({
        status: 'published',
        page,
        pageSize,
        _bypassBeforeRead: true,
      })
      for (const doc of batch.docs) {
        await this.indexDocument(doc.id)
        result.documents++
      }
      if (page >= batch.meta.totalPages || batch.docs.length === 0) break
      page++
    }
    // `indexed` mirrors documents × locales present; the provider upserts are
    // the source of truth, so report the document count walked.
    result.indexed = result.documents
    return result
  }

  /**
   * Build the populate map for this collection's facet relation fields so each
   * target arrives with the two fields the assembler needs: its `counter` field
   * (the aggregation id) and its identity field (`useAsTitle`, the term).
   * Returns `undefined` when the collection declares no facets.
   */
  private buildSearchFacetPopulateMap(): PopulateMap | undefined {
    const facets = this.definition.search?.facets
    if (facets == null || facets.length === 0) return undefined

    const map: PopulateMap = {}
    for (const decl of facets) {
      const name = typeof decl === 'string' ? decl : decl.field
      const field = this.definition.fields.find((f) => f.name === name)
      if (field == null || field.type !== 'relation') continue

      const targetPath = (field as { targetCollection?: string }).targetCollection
      const targetDef = targetPath
        ? this.client.collections.find((c) => c.path === targetPath)
        : undefined
      const select: string[] = []
      const idField = targetDef?.fields.find((f) => f.type === 'counter')?.name
      const termField = targetDef ? resolveIdentityField(targetDef) : undefined
      if (idField) select.push(idField)
      if (termField) select.push(termField)

      map[name] = select.length > 0 ? { select } : true
    }

    return Object.keys(map).length > 0 ? map : undefined
  }

  /**
   * Find a document by its logical document ID.
   */
  async findById<F = TFields>(
    documentId: string,
    options: FindByIdOptions<F> = {}
  ): Promise<ClientDocument<F> | null> {
    const readMode = resolveReadMode(options.status)
    const readCtx = options._readContext ?? createReadContext()
    const requestContext = await this.resolveAndAssertRead(readMode, readCtx)
    const collectionId = await this.client.resolveCollectionId(this.definition.path)
    const { locale = this.client.defaultLocale } = options

    const filters = await this.resolveBeforeReadFilters(
      requestContext,
      readCtx,
      options._bypassBeforeRead
    )

    const raw = await this.client.db.queries.documents.getDocumentById({
      collection_id: collectionId,
      document_id: documentId,
      locale,
      reconstruct: true,
      readMode,
      filters,
      lenient: options.lenient,
      onMissingLocale: options.onMissingLocale ?? 'fallback',
    })

    if (raw == null) return null

    // Trim to selected fields BEFORE populate so populate doesn't waste work
    // on relations the caller filtered out. Mutates `raw.fields` in place.
    if (options.select?.length) {
      trimFields(raw as Record<string, any>, options.select as string[])
    }

    await this.populateIfRequested(
      collectionId,
      [raw as Record<string, any>],
      locale,
      readMode,
      requestContext,
      {
        ...options,
        _readContext: readCtx,
      }
    )

    await this.finishReadDocuments(
      [raw as Record<string, any>],
      readCtx,
      requestContext,
      locale,
      readMode,
      options._bypassBeforeRead,
      options.select as string[] | undefined,
      readMaterialization(options.populate, options.depth)
    )

    return this.shapeWithPopulated<F>(raw as Record<string, any>)
  }

  /**
   * Find a document by its URL path/slug. Returns `null` when no document
   * exists at the given path (the storage adapter resolves missing paths
   * to `null` rather than throwing).
   */
  async findByPath<F = TFields>(
    path: string,
    options: FindByPathOptions<F> = {}
  ): Promise<ClientDocument<F> | null> {
    const readMode = resolveReadMode(options.status)
    const readCtx = options._readContext ?? createReadContext()
    const requestContext = await this.resolveAndAssertRead(readMode, readCtx)
    const collectionId = await this.client.resolveCollectionId(this.definition.path)
    const { locale = this.client.defaultLocale } = options

    const filters = await this.resolveBeforeReadFilters(
      requestContext,
      readCtx,
      options._bypassBeforeRead
    )

    const raw = await this.client.db.queries.documents.getDocumentByPath({
      collection_id: collectionId,
      path,
      locale,
      reconstruct: true,
      readMode,
      filters,
      onMissingLocale: options.onMissingLocale ?? 'fallback',
    })

    if (raw == null) return null

    if (options.select?.length) {
      trimFields(raw as Record<string, any>, options.select as string[])
    }

    await this.populateIfRequested(
      collectionId,
      [raw as Record<string, any>],
      locale,
      readMode,
      requestContext,
      {
        ...options,
        _readContext: readCtx,
      }
    )

    await this.finishReadDocuments(
      [raw as Record<string, any>],
      readCtx,
      requestContext,
      locale,
      readMode,
      options._bypassBeforeRead,
      options.select as string[] | undefined,
      readMaterialization(options.populate, options.depth)
    )

    return this.shapeWithPopulated<F>(raw as Record<string, any>)
  }

  // -------------------------------------------------------------------------
  // Write path
  //
  // Each method resolves the collection id, builds a DocumentLifecycleContext,
  // and delegates to the corresponding `document-lifecycle` service. Hooks
  // declared on the collection definition (beforeCreate, afterCreate, …) run
  // inside those services — no separate wiring is needed here.
  //
  // Patches stay admin-internal: the client API does whole-document writes
  // only. UI-level intent (array reordering, block insertion) belongs to the
  // admin route layer, not to a framework-agnostic SDK.
  // -------------------------------------------------------------------------

  /**
   * Create a new document in this collection.
   *
   * `data` is a plain object matching the collection's field shape. When
   * `options.status` is omitted the collection's default status (from its
   * workflow definition) is used.
   */
  async create(
    data: Record<string, any>,
    options: CreateOptions = {}
  ): Promise<CreateDocumentResult> {
    const ctx = await this.buildLifecycleContext()
    return createDocument(ctx, {
      data,
      locale: options.locale,
      status: options.status,
      path: options.path,
      availableLocales: options.availableLocales,
    })
  }

  /**
   * Update an existing document via full replacement (PUT semantics).
   * Creates a new immutable version row. Hooks receive the real previous
   * version as `originalData`.
   */
  async update(
    documentId: string,
    data: Record<string, any>,
    options: UpdateOptions = {}
  ): Promise<UpdateDocumentResult> {
    const ctx = await this.buildLifecycleContext()
    return updateDocument(ctx, {
      documentId,
      data,
      locale: options.locale,
      path: options.path,
      availableLocales: options.availableLocales,
    })
  }

  /**
   * Change a document's workflow status. The transition is validated
   * against the collection's declared workflow (±1 step or reset-to-first);
   * transitioning to `'published'` auto-archives any other published
   * versions of the same document.
   */
  async changeStatus(documentId: string, nextStatus: string): Promise<ChangeStatusResult> {
    const ctx = await this.buildLifecycleContext()
    return changeDocumentStatus(ctx, { documentId, nextStatus })
  }

  /**
   * Archive the currently-published version(s) of a document.
   */
  async unpublish(documentId: string): Promise<UnpublishResult> {
    const ctx = await this.buildLifecycleContext()
    return unpublishDocument(ctx, { documentId })
  }

  /**
   * Restore a historical version as the new current version of this
   * document. Creates a new immutable version row whose content is copied
   * from the source version (all locales, with block / array `_id` identity
   * preserved) and whose status defaults to the workflow's first status —
   * never re-publishes silently.
   *
   * Reuses the `update` ability. Fires `beforeUpdate` / `afterUpdate` with
   * a `restore: { sourceVersionId }` field on the hook context so userland
   * hooks can branch.
   */
  async restoreVersion(documentId: string, sourceVersionId: string): Promise<RestoreVersionResult> {
    const ctx = await this.buildLifecycleContext()
    return restoreDocumentVersion(ctx, { documentId, sourceVersionId })
  }

  /**
   * Soft-delete a document. All versions are flagged `is_deleted = true`
   * and disappear from read paths (the `current_documents` view filters
   * them out). When the collection has any upload-capable image/file
   * field and a storage provider is configured, the original file and
   * every persisted variant on each upload-capable field are removed
   * after the DB soft-delete — failures there are logged but non-fatal.
   */
  async delete(documentId: string): Promise<DeleteDocumentResult> {
    const ctx = await this.buildLifecycleContext()
    return deleteDocument(ctx, { documentId })
  }

  /**
   * Sum the current-version workflow status buckets visible to the actor,
   * optionally selecting one exact status. This is an editorial status-count
   * API, not an ordinary published-view document count; it therefore
   * authorizes as `readMode: 'any'` and rejects anonymous callers.
   *
   * Applies the collection's `beforeRead` predicate so the count reflects
   * only the rows the actor can see (multi-tenant scoping, owner-only
   * drafts, soft-delete hide, etc).
   */
  async count(where?: { status?: string; _bypassBeforeRead?: true }): Promise<number> {
    const counts = await this.countByStatus({
      _bypassBeforeRead: where?._bypassBeforeRead,
    })
    if (where?.status) {
      const match = counts.find((c) => c.status === where.status)
      return match?.count ?? 0
    }
    return counts.reduce((sum, c) => sum + c.count, 0)
  }

  /**
   * Per-status document counts for this collection. Used by admin status
   * bars / dashboards. This always reads current versions across statuses,
   * authorizes as `readMode: 'any'`, and applies `beforeRead` so counts reflect
   * only the actor's visible rows.
   */
  async countByStatus(
    options: { _bypassBeforeRead?: true } = {}
  ): Promise<Array<{ status: string; count: number }>> {
    const readCtx = createReadContext()
    const requestContext = await this.resolveAndAssertRead('any', readCtx)
    const collectionId = await this.client.resolveCollectionId(this.definition.path)
    const filters = await this.resolveBeforeReadFilters(
      requestContext,
      readCtx,
      options._bypassBeforeRead
    )
    return this.client.db.queries.documents.getDocumentCountsByStatus({
      collection_id: collectionId,
      filters,
    })
  }

  /**
   * Fetch the version history for a single document. Applies `beforeRead`
   * independently to every immutable version before pagination and counting,
   * so ownership changes cannot expose hidden version content or metadata.
   *
   * Each version in the response is a shaped `ClientDocument`. Pagination
   * mirrors the storage adapter's `{ documents, meta }` shape, then is
   * mapped to the same `{ docs, meta }` envelope `find()` returns.
   */
  async history<F = TFields>(
    documentId: string,
    options: HistoryOptions = {}
  ): Promise<FindResult<F>> {
    const readCtx = options._readContext ?? createReadContext()
    const requestContext = await this.resolveAndAssertRead('any', readCtx)
    const collectionId = await this.client.resolveCollectionId(this.definition.path)
    const locale = options.locale ?? this.client.defaultLocale
    const page = options.page ?? 1
    const pageSize = options.pageSize ?? 20

    const filters = await this.resolveBeforeReadFilters(
      requestContext,
      readCtx,
      options._bypassBeforeRead
    )

    const result = await this.client.db.queries.documents.getDocumentHistory({
      collection_id: collectionId,
      document_id: documentId,
      locale,
      page,
      page_size: pageSize,
      order: options.order,
      desc: options.desc,
      filters,
    })

    await this.finishReadDocuments(
      result.documents,
      readCtx,
      requestContext,
      locale,
      'any',
      options._bypassBeforeRead,
      undefined,
      'historical-version'
    )

    return {
      docs: result.documents.map((d) => this.shapeWithPopulated<F>(d)),
      meta: {
        total: result.meta.total,
        page: result.meta.page,
        pageSize: result.meta.page_size,
        totalPages: result.meta.total_pages,
      },
    }
  }

  /**
   * Fetch the document-grain audit log for a single document (docs/06-auth-and-security/02-auditability.md —
   * Workstream 3): the non-versioned system-field writes (path,
   * available-locales), in-place status transitions, and the deletion event
   * the immutable version stream deliberately does not record an actor for.
   *
   * Applies `beforeRead` as a current-document access gate via `findById`, so
   * an actor who cannot see the document at all gets an empty log rather than
   * leaking change metadata. Entries are newest-first.
   * Actor *ids* are returned raw; resolving them to display labels is an
   * admin-realm concern handled above the SDK.
   *
   * Returns an empty page when the adapter has no audit-query capability
   * (`queries.audit` absent) — the same graceful shape as a gated-out read.
   */
  async auditLog(documentId: string, options: AuditLogOptions = {}): Promise<AuditLogPage> {
    const readCtx = options._readContext ?? createReadContext()
    await this.resolveAndAssertRead('any', readCtx)
    const locale = options.locale ?? this.client.defaultLocale
    const page = options.page ?? 1
    const pageSize = options.pageSize ?? 20

    const empty: AuditLogPage = { entries: [], meta: { total: 0, page, pageSize, totalPages: 0 } }

    // Access gate — same rationale as `history()`. `status: 'any'` asks "can
    // the actor see *any* version of this document?", so a draft-only doc with
    // the owning actor still surfaces its audit log.
    if (!options._bypassBeforeRead) {
      const accessible = await this.findById(documentId, {
        locale,
        status: 'any',
        _readContext: readCtx,
      })
      if (accessible == null) return empty
    }

    const audit = this.client.db.queries.audit
    if (audit == null) return empty

    return audit.getDocumentAuditLog({
      document_id: documentId,
      page,
      page_size: pageSize,
    })
  }

  /**
   * Fetch a specific version of a document by its `documentVersionId`.
   * Used by admin diff views.
   *
   * The adapter query is constrained to this handle's collection and applies
   * the collection's strict `beforeRead` predicate directly to the historical
   * version. Unknown, cross-collection, and row-scoped version ids all return
   * `null` without revealing ownership.
   */
  async findByVersion<F = TFields>(
    versionId: string,
    options: FindByVersionOptions<F> = {}
  ): Promise<ClientDocument<F> | null> {
    const readCtx = options._readContext ?? createReadContext()
    const requestContext = await this.resolveAndAssertRead('any', readCtx)
    const collectionId = await this.client.resolveCollectionId(this.definition.path)
    const filters = await this.resolveBeforeReadFilters(
      requestContext,
      readCtx,
      options._bypassBeforeRead
    )
    const locale = options.locale ?? this.client.defaultLocale
    const raw = await this.client.db.queries.documents.getDocumentByVersion({
      document_version_id: versionId,
      locale,
      collection_id: collectionId,
      filters,
    })
    if (raw == null) return null
    if (options.select?.length) {
      trimFields(raw as Record<string, any>, options.select as string[])
    }
    await this.finishReadDocuments(
      [raw as Record<string, any>],
      readCtx,
      requestContext,
      locale,
      'any',
      options._bypassBeforeRead,
      options.select as string[] | undefined,
      'historical-version'
    )
    return this.shapeWithPopulated<F>(raw as Record<string, any>)
  }

  // -------------------------------------------------------------------------
  // Document tree (the `tree: true` primitive — docs/04-collections/03-document-trees.md)
  //
  // A document-grain, unversioned single-parent ordered hierarchy. Reads/writes
  // here go through the storage adapter's dedicated tree commands, NOT the
  // store_relation / populate pipeline. Every method requires the collection to
  // be a tree (`tree: true`); writes assert the `update` ability (structural
  // moves are metadata-level updates), reads assert `read`.
  // -------------------------------------------------------------------------

  /**
   * Place or move a document within this collection's tree — a single upsert
   * covering place, reorder, and re-parent (they differ only in whether the
   * parent changes). Document-grain and unversioned: mints no new document
   * version and does not touch workflow status. The storage layer enforces the
   * cycle and same-collection invariants atomically. Returns the minted
   * per-parent `order_key`.
   */
  async placeTreeNode(
    documentId: string,
    options: PlaceTreeNodeOptions
  ): Promise<{ orderKey: string }> {
    this.assertTreeCollection()
    const ctx = await this.buildLifecycleContext()
    return placeTreeNodeLifecycle(ctx, {
      documentId,
      parentDocumentId: options.parentDocumentId,
      beforeDocumentId: options.beforeDocumentId ?? null,
      afterDocumentId: options.afterDocumentId ?? null,
      reconcile: options.reconcile,
    })
  }

  /**
   * Remove a document from the tree, returning it to the *unplaced* state (still
   * in the collection, but not in any table of contents). Distinct from
   * deleting the document. No-op when already unplaced.
   */
  async removeFromTree(documentId: string, options: RemoveFromTreeOptions = {}): Promise<void> {
    this.assertTreeCollection()
    const ctx = await this.buildLifecycleContext()
    await removeFromTreeLifecycle(ctx, { documentId, reconcile: options.reconcile })
  }

  /**
   * Read a node's subtree as a nested {@link TreeNode} forest, hydrated to
   * `ClientDocument`s. `rootDocumentId: null` (default) returns the whole tree
   * from the collection roots; a value returns the subtree rooted at (and
   * including) that node. Children are ordered per-parent. `status` defaults to
   * `'published'` (the client default) — an unpublished node hides its whole
   * subtree in that mode. `beforeRead` visibility follows the same edge rule:
   * a hidden node and its descendants are omitted, never promoted.
   */
  async getSubtree<F = TFields>(options: GetSubtreeOptions<F> = {}): Promise<TreeNode<F>[]> {
    this.assertTreeCollection()
    const readMode = resolveReadMode(options.status)
    const readCtx = options._readContext ?? createReadContext()
    const requestContext = await this.resolveAndAssertRead(readMode, readCtx)
    const collectionId = await this.client.resolveCollectionId(this.definition.path)
    const locale = options.locale ?? this.client.defaultLocale
    const filters = await this.resolveBeforeReadFilters(
      requestContext,
      readCtx,
      options._bypassBeforeRead
    )

    const structure = await this.client.db.queries.documents.getTreeSubtree({
      collectionId,
      rootDocumentId: options.rootDocumentId ?? null,
      maxDepth: options.depth,
      readMode,
      locale,
      filters,
    })
    if (structure.length === 0) return []

    const shapedById = await this.hydrateTreeNodes<F>(
      collectionId,
      structure.map((n) => n.document_id),
      locale,
      readMode,
      options.select as string[] | undefined,
      filters,
      readCtx,
      requestContext,
      options._bypassBeforeRead
    )

    // Assemble the nested forest. Rows arrive pre-order, so a parent is always
    // materialised before its children; a row whose parent is not in the result
    // set (null parent, or the requested root's own parent) is a top-level node.
    const structuralIds = new Set(structure.map((row) => row.document_id))
    const nodeById = new Map<string, TreeNode<F>>()
    const roots: TreeNode<F>[] = []
    for (const row of structure) {
      const document = shapedById.get(row.document_id)
      if (document == null) continue
      const node: TreeNode<F> = { document, depth: row.depth, children: [] }
      nodeById.set(row.document_id, node)
      const parent =
        row.parent_document_id != null ? nodeById.get(row.parent_document_id) : undefined
      if (parent) {
        parent.children.push(node)
      } else if (row.parent_document_id == null || !structuralIds.has(row.parent_document_id)) {
        roots.push(node)
      }
    }
    return roots
  }

  /**
   * Walk a document's ancestor chain upward, returning the ancestors
   * **root-first** (the breadcrumb trail, excluding the node itself), hydrated
   * to `ClientDocument`s. In `'published'` mode (the client default) the walk
   * applies status-at-edge: it stops at the first unpublished ancestor (a
   * truncated chain), so a broken spine surfaces as a short chain the caller can
   * detect rather than a silently-compacted one. A `beforeRead`-hidden ancestor
   * breaks the edge identically.
   */
  async getAncestors<F = TFields>(
    documentId: string,
    options: GetAncestorsOptions<F> = {}
  ): Promise<ClientDocument<F>[]> {
    this.assertTreeCollection()
    const readMode = resolveReadMode(options.status)
    const readCtx = options._readContext ?? createReadContext()
    const requestContext = await this.resolveAndAssertRead(readMode, readCtx)
    const collectionId = await this.client.resolveCollectionId(this.definition.path)
    const locale = options.locale ?? this.client.defaultLocale
    const filters = await this.resolveBeforeReadFilters(
      requestContext,
      readCtx,
      options._bypassBeforeRead
    )

    const ancestors = await this.client.db.queries.documents.getTreeAncestors({
      document_id: documentId,
      readMode,
      locale,
      filters,
    })
    if (ancestors.length === 0) return []

    const ids = ancestors.map((a) => a.document_id)
    const shapedById = await this.hydrateTreeNodes<F>(
      collectionId,
      ids,
      locale,
      readMode,
      options.select as string[] | undefined,
      filters,
      readCtx,
      requestContext,
      options._bypassBeforeRead
    )
    // A hydration-time miss truncates the edge rather than compacting past a
    // newly-hidden ancestor.
    const visible: ClientDocument<F>[] = []
    for (let i = ids.length - 1; i >= 0; i--) {
      const id = ids[i]
      if (id == null) break
      const document = shapedById.get(id)
      if (document == null) break
      visible.unshift(document)
    }
    return visible
  }

  /**
   * Resolve a document's placement state in the tree — the tri-state that
   * `getAncestors` cannot express (it returns `[]` for both a root and an
   * unplaced node). Returns `{ placed, parentDocumentId }`: `placed: false` is
   * *unplaced* (no edge row), `placed: true` with a null parent is a *root*, and
   * a non-null parent is a *child*. A hidden queried node reports unplaced; a
   * visible child of a hidden parent remains placed but the parent id is
   * redacted to null. Structure-only — no document hydration.
   */
  async getTreeParent(
    documentId: string,
    options: GetTreeParentOptions = {}
  ): Promise<TreeParentResult> {
    this.assertTreeCollection()
    const readMode = resolveReadMode(options.status)
    const readCtx = options._readContext ?? createReadContext()
    const requestContext = await this.resolveAndAssertRead(readMode, readCtx)
    const filters = await this.resolveBeforeReadFilters(
      requestContext,
      readCtx,
      options._bypassBeforeRead
    )
    const result = await this.client.db.queries.documents.getTreeParent({
      document_id: documentId,
      readMode,
      locale: options.locale ?? this.client.defaultLocale,
      filters,
    })
    return {
      placed: result.placed,
      parentDocumentId: result.parentDocumentId,
      parentVisibility: result.parentRedacted
        ? 'redacted'
        : result.parentDocumentId != null
          ? 'visible'
          : 'none',
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Build a fresh `DocumentLifecycleContext` for a write call. Pulls the
   * resolved collection id, inherits the client-wide logger and storage
   * provider, and includes the collection definition so hooks can observe it.
   */
  private async buildLifecycleContext(): Promise<DocumentLifecycleContext> {
    const { id: collectionId, version: collectionVersion } =
      await this.client.resolveCollectionRecord(this.definition.path)
    return {
      db: this.client.db,
      definition: this.definition,
      collectionId,
      collectionVersion,
      collectionPath: this.definition.path,
      storage: this.client.storage,
      logger: this.client.logger,
      defaultLocale: this.client.defaultLocale,
      slugifier: this.client.slugifier,
      requestContext: await this.client.resolveRequestContext(),
    }
  }

  /**
   * Resolve the caller's `RequestContext` and enforce the read ability
   * for this collection. Called at the top of every read entry point so
   * reads and writes both fail closed at the service boundary.
   *
   * Returns the resolved context so callers can thread `readMode` and
   * other per-request state into the adapter without re-resolving.
   */
  private async resolveAndAssertRead(
    readMode: ReadMode,
    readContext: ReadContext
  ): Promise<RequestContext> {
    const requestContext = await resolveReadRequestContext(this.client, readContext, readMode)
    assertActorCanPerform(requestContext, this.definition.path, 'read')
    return requestContext
  }

  /**
   * Guard that this collection opts into the document-tree primitive. The
   * tree commands are inert (and the read path meaningless) for a non-tree
   * collection, so fail loudly rather than silently writing edge rows that
   * nothing will read.
   */
  private assertTreeCollection(): void {
    if (this.definition.tree !== true) {
      throw ERR_VALIDATION({
        message: `collection '${this.definition.path}' is not a document tree; set \`tree: true\` on its collection definition to use the tree API`,
        details: { collectionPath: this.definition.path },
      })
    }
  }

  /**
   * Batch-hydrate a set of tree node document ids into shaped
   * `ClientDocument`s, keyed by document id. Reuses the populate batch read
   * (`getDocumentsByDocumentIds`) under the requested `readMode` — the tree's
   * own status/beforeRead edge filtering already happened structurally, and the
   * same filters are applied again to close the structure/hydration race. Fires
   * `afterRead` per node (deduped within one shared `ReadContext`) to stay
   * consistent with the other client read paths.
   */
  private async hydrateTreeNodes<F>(
    collectionId: string,
    documentIds: string[],
    locale: string,
    readMode: ReadMode,
    select: string[] | undefined,
    filters: DocumentFilter[] | undefined,
    readContext: ReadContext,
    requestContext: RequestContext,
    bypassBeforeRead: true | undefined
  ): Promise<Map<string, ClientDocument<F>>> {
    const shapedById = new Map<string, ClientDocument<F>>()
    if (documentIds.length === 0) return shapedById

    const rawDocs = await this.client.db.queries.documents.getDocumentsByDocumentIds({
      collection_id: collectionId,
      document_ids: documentIds,
      locale,
      readMode,
      fields: select,
      filters,
    })

    await this.finishReadDocuments(
      rawDocs as Array<Record<string, any>>,
      readContext,
      requestContext,
      locale,
      readMode,
      bypassBeforeRead,
      select,
      'tree'
    )

    for (const raw of rawDocs) {
      const doc = raw as Record<string, any>
      shapedById.set(doc.document_id as string, this.shapeWithPopulated<F>(doc))
    }
    return shapedById
  }

  /**
   * Invoke `populateDocuments` on a freshly-read (raw, storage-shape) set
   * of documents when the caller asked for populate. No-op otherwise.
   *
   * Runs BEFORE `shapeDocument` so the populate service sees the raw
   * `{document_id, fields}` shape it expects. The shape pass
   * (`shapeWithPopulated`) then walks the mutated tree and converts every
   * newly-inserted raw sub-document into a `ClientDocument`.
   */
  private async populateIfRequested(
    collectionId: string,
    rawDocs: Record<string, any>[],
    locale: string,
    readMode: ReadMode,
    requestContext: RequestContext,
    options: {
      populate?: PopulateSpec
      depth?: number
      _readContext?: ReadContext
      _bypassBeforeRead?: true
    }
  ): Promise<void> {
    if (options.populate === undefined) return
    await populateDocuments({
      db: this.client.db,
      collections: this.client.collections,
      collectionId,
      documents: rawDocs,
      populate: options.populate,
      depth: options.depth,
      locale,
      readMode,
      readContext: options._readContext,
      requestContext,
      bypassBeforeRead: options._bypassBeforeRead,
      richTextPopulate: this.client.richTextPopulate,
    })
  }

  /**
   * Apply richtext populate to a freshly-read set of source documents.
   * Mirrors what `populateDocuments` does for materialised targets, but
   * runs unconditionally for sources because `richTextPopulate` is a
   * framework-managed phase rather than a user-opted DSL like
   * `populate`/`depth`. Each leaf is gated by its own
   * `populateRelationsOnRead` inside the service. No-ops when no adapter
   * is registered.
   */
  private async richTextPopulateSources(
    rawDocs: Record<string, any>[],
    readContext: ReadContext,
    requestContext: RequestContext,
    locale: string,
    readMode: ReadMode,
    bypassBeforeRead: true | undefined
  ): Promise<void> {
    const populate = this.client.richTextPopulate
    if (!populate || rawDocs.length === 0) return
    await populateRichTextFields({
      fields: this.definition.fields,
      collectionPath: this.definition.path,
      documents: rawDocs,
      populate,
      readContext,
      requestContext,
      readMode,
      readDocuments: createRichTextDocumentReader({
        db: this.client.db,
        collections: this.client.collections,
        requestContext,
        readContext,
        readMode,
        locale,
        bypassBeforeRead,
        richTextPopulate: populate,
      }),
    })
  }

  /** Complete the common post-reconstruction pipeline in security order. */
  private async finishReadDocuments(
    rawDocs: Record<string, any>[],
    readContext: ReadContext,
    requestContext: RequestContext,
    locale: string,
    readMode: ReadMode,
    bypassBeforeRead: true | undefined,
    projection: string[] | undefined,
    materialization: string
  ): Promise<void> {
    // Rich-text targets must be authorised and refreshed before user hooks see
    // the document, regardless of which read entry point materialised it.
    await this.richTextPopulateSources(
      rawDocs,
      readContext,
      requestContext,
      locale,
      readMode,
      bypassBeforeRead
    )
    for (const doc of rawDocs) {
      await applyAfterRead({
        doc,
        definition: this.definition,
        readContext,
        requestContext,
        locale,
        readMode,
        projection,
        materialization,
      })
    }
  }

  /**
   * Resolve and cache the `beforeRead` hook predicate for this collection
   * inside the current `ReadContext`. Honours `_bypassBeforeRead` (admin
   * tooling, seeds, migrations).
   */
  private async resolveBeforeReadPredicate(
    requestContext: RequestContext,
    readContext: ReadContext,
    bypass: true | undefined
  ) {
    if (bypass) return null
    const predicate = await applyBeforeRead({
      definition: this.definition,
      requestContext,
      readContext,
    })
    if (predicate != null) {
      await parsePredicateFilters(
        predicate,
        this.definition,
        {
          collections: this.client.collections,
          resolveCollectionId: (path) => this.client.resolveCollectionId(path),
          logger: this.client.logger,
        },
        { strict: true }
      )
    }
    return predicate
  }

  /**
   * Like `resolveBeforeReadPredicate`, but parses the predicate to the
   * adapter-facing `DocumentFilter[]` shape used by `getDocumentById` /
   * `getDocumentByPath`. Returns `undefined` (not `[]`) when there is no
   * scoping, so the adapter can skip the loop entirely.
   */
  private async resolveBeforeReadFilters(
    requestContext: RequestContext,
    readContext: ReadContext,
    bypass: true | undefined
  ): Promise<DocumentFilter[] | undefined> {
    const predicate = await this.resolveBeforeReadPredicate(requestContext, readContext, bypass)
    if (predicate == null) return undefined
    const filters = await parsePredicateFilters(
      predicate,
      this.definition,
      {
        collections: this.client.collections,
        resolveCollectionId: (path) => this.client.resolveCollectionId(path),
        logger: this.client.logger,
      },
      { strict: true }
    )
    return filters.length > 0 ? filters : undefined
  }

  /**
   * Shape a raw doc to `ClientDocument<F>`, then recursively shape any
   * populated raw sub-documents inside its `fields`. Stubs
   * (`_resolved: false` / `_cycle: true`) and plain field values are
   * preserved by reference.
   */
  private shapeWithPopulated<F>(raw: Record<string, any>): ClientDocument<F> {
    const shaped = shapeDocument<F>(raw)
    shaped.fields = shapePopulatedInPlace(shaped.fields) as F
    return shaped
  }
}

/**
 * Resolve the client-facing `status` option to an adapter `readMode`.
 *
 * Public @byline/client consumers default to `'published'` — safer for
 * non-admin use because a newer draft won't leak through populate or
 * over-write the previously-published content a reader expects to see.
 * Callers (typically admin server fns) pass `'any'` explicitly when
 * they want the current version regardless of status.
 */
function resolveReadMode(status: ReadMode | undefined): ReadMode {
  return status ?? 'published'
}

function readMaterialization(
  populate: PopulateSpec | undefined,
  depth: number | undefined
): string {
  if (populate === undefined) return 'document'
  return `populate:${depth ?? 1}:${typeof populate === 'object' ? JSON.stringify(populate) : populate}`
}

/** Mutate `raw.fields` to retain only the entries matching `select`. */
function trimFields(raw: Record<string, any>, select: string[]): void {
  const fields = raw.fields
  if (fields == null || typeof fields !== 'object') return
  const allowed = new Set(select)
  for (const k of Object.keys(fields)) {
    if (!allowed.has(k)) delete fields[k]
  }
}
