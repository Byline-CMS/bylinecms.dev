/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { RequestContext } from '@byline/auth'
import type {
  ChangeStatusResult,
  CollectionDefinition,
  CreateDocumentResult,
  DeleteDocumentResult,
  DocumentFilter,
  DocumentLifecycleContext,
  PopulateSpec,
  ReadContext,
  ReadMode,
  UnpublishResult,
  UpdateDocumentResult,
} from '@byline/core'
import {
  applyAfterRead,
  applyBeforeRead,
  assertActorCanPerform,
  changeDocumentStatus,
  createDocument,
  createReadContext,
  deleteDocument,
  mergePredicates,
  parseSort,
  parseWhere,
  populateDocuments,
  unpublishDocument,
  updateDocument,
} from '@byline/core'

import { shapeDocument, shapePopulatedInPlace } from './response.js'
import type { BylineClient } from './client.js'
import type {
  ClientDocument,
  CreateOptions,
  FindByIdOptions,
  FindByPathOptions,
  FindByVersionOptions,
  FindOneOptions,
  FindOptions,
  FindResult,
  HistoryOptions,
  UpdateOptions,
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
  async find<F = Record<string, any>>(options: FindOptions<F> = {}): Promise<FindResult<F>> {
    const requestContext = await this.resolveAndAssertRead()
    const collectionId = await this.client.resolveCollectionId(this.definition.path)
    const { where, select, sort, locale = 'en', page = 1, pageSize = 20 } = options
    const readMode = resolveReadMode(options.status)
    const readCtx = options._readContext ?? createReadContext()

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

    // Fire afterRead for each source document AFTER populate so the hook
    // sees the fully populated tree. Targets were already fired inside
    // populate. applyAfterRead deduplicates via readCtx.afterReadFired.
    for (const d of result.documents) {
      await applyAfterRead({ doc: d, definition: this.definition, readContext: readCtx })
    }

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
  async findOne<F = Record<string, any>>(
    options: FindOneOptions<F> = {}
  ): Promise<ClientDocument<F> | null> {
    const result = await this.find<F>({
      where: options.where,
      select: options.select,
      locale: options.locale,
      page: 1,
      pageSize: 1,
      populate: options.populate,
      depth: options.depth,
      status: options.status,
      _readContext: options._readContext,
      _bypassBeforeRead: options._bypassBeforeRead,
    })
    return result.docs[0] ?? null
  }

  /**
   * Find a document by its logical document ID.
   */
  async findById<F = Record<string, any>>(
    documentId: string,
    options: FindByIdOptions<F> = {}
  ): Promise<ClientDocument<F> | null> {
    const requestContext = await this.resolveAndAssertRead()
    const collectionId = await this.client.resolveCollectionId(this.definition.path)
    const { locale = 'en' } = options
    const readMode = resolveReadMode(options.status)
    const readCtx = options._readContext ?? createReadContext()

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

    await applyAfterRead({
      doc: raw as Record<string, any>,
      definition: this.definition,
      readContext: readCtx,
    })

    return this.shapeWithPopulated<F>(raw as Record<string, any>)
  }

  /**
   * Find a document by its URL path/slug. Returns `null` when no document
   * exists at the given path (the storage adapter resolves missing paths
   * to `null` rather than throwing).
   */
  async findByPath<F = Record<string, any>>(
    path: string,
    options: FindByPathOptions<F> = {}
  ): Promise<ClientDocument<F> | null> {
    const requestContext = await this.resolveAndAssertRead()
    const collectionId = await this.client.resolveCollectionId(this.definition.path)
    const { locale = 'en' } = options
    const readMode = resolveReadMode(options.status)
    const readCtx = options._readContext ?? createReadContext()

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

    await applyAfterRead({
      doc: raw as Record<string, any>,
      definition: this.definition,
      readContext: readCtx,
    })

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
   * Count documents visible to the current actor, optionally filtered by
   * status.
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
   * bars / dashboards. Applies `beforeRead` so per-status counts reflect
   * only the actor's visible rows.
   */
  async countByStatus(
    options: { _bypassBeforeRead?: true } = {}
  ): Promise<Array<{ status: string; count: number }>> {
    const requestContext = await this.resolveAndAssertRead()
    const collectionId = await this.client.resolveCollectionId(this.definition.path)
    const filters = await this.resolveBeforeReadFilters(
      requestContext,
      createReadContext(),
      options._bypassBeforeRead
    )
    return this.client.db.queries.documents.getDocumentCountsByStatus({
      collection_id: collectionId,
      filters,
    })
  }

  /**
   * Fetch the version history for a single document. Applies `beforeRead`
   * as an access gate via `findById` — if the actor can't see the
   * document at all, history returns an empty result rather than
   * leaking version metadata.
   *
   * Each version in the response is a shaped `ClientDocument`. Pagination
   * mirrors the storage adapter's `{ documents, meta }` shape, then is
   * mapped to the same `{ docs, meta }` envelope `find()` returns.
   */
  async history<F = Record<string, any>>(
    documentId: string,
    options: HistoryOptions = {}
  ): Promise<FindResult<F>> {
    const _requestContext = await this.resolveAndAssertRead()
    const collectionId = await this.client.resolveCollectionId(this.definition.path)
    const readCtx = options._readContext ?? createReadContext()
    const locale = options.locale ?? 'en'
    const page = options.page ?? 1
    const pageSize = options.pageSize ?? 20

    // Access gate. `findById` runs `beforeRead`; a `null` here means either
    // the document does not exist or the actor's predicate excludes it. In
    // both cases an empty history is the correct response.
    //
    // `status: 'any'` so the gate asks "can the actor see *any* version of
    // this document?" rather than the client's default "is there a
    // published version they can see?". A draft-only document with the
    // owning actor should still surface history; using the published-only
    // default would gate them out incorrectly.
    if (!options._bypassBeforeRead) {
      const accessible = await this.findById(documentId, {
        locale,
        status: 'any',
        _readContext: readCtx,
      })
      if (accessible == null) {
        return {
          docs: [],
          meta: { total: 0, page, pageSize, totalPages: 0 },
        }
      }
    }

    const result = await this.client.db.queries.documents.getDocumentHistory({
      collection_id: collectionId,
      document_id: documentId,
      locale,
      page,
      page_size: pageSize,
      order: options.order,
      desc: options.desc,
    })

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
   * Fetch a specific version of a document by its `documentVersionId`.
   * Used by admin diff views.
   *
   * Pass-through to `getDocumentByVersion`; access enforcement falls back
   * to the collection-level `read` ability (asserted at the top of every
   * read entry point). Row-level `beforeRead` does **not** apply here —
   * version-by-id is a history-viewing primitive and the caller is
   * expected to have already passed an access check on the parent
   * document. Use `history()` instead if you want the access gate.
   */
  async findByVersion<F = Record<string, any>>(
    versionId: string,
    options: FindByVersionOptions<F> = {}
  ): Promise<ClientDocument<F> | null> {
    await this.resolveAndAssertRead()
    const locale = options.locale ?? 'en'
    const raw = await this.client.db.queries.documents.getDocumentByVersion({
      document_version_id: versionId,
      locale,
    })
    if (raw == null) return null
    return this.shapeWithPopulated<F>(raw as Record<string, any>)
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
  private async resolveAndAssertRead(): Promise<RequestContext> {
    const requestContext = await this.client.resolveRequestContext()
    assertActorCanPerform(requestContext, this.definition.path, 'read')
    return requestContext
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
    })
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
    return applyBeforeRead({
      definition: this.definition,
      requestContext,
      readContext,
    })
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
    const parsed = await parseWhere(predicate, this.definition, {
      collections: this.client.collections,
      resolveCollectionId: (path) => this.client.resolveCollectionId(path),
      logger: this.client.logger,
    })
    return parsed.filters.length > 0 ? parsed.filters : undefined
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

/** Mutate `raw.fields` to retain only the entries matching `select`. */
function trimFields(raw: Record<string, any>, select: string[]): void {
  const fields = raw.fields
  if (fields == null || typeof fields !== 'object') return
  const allowed = new Set(select)
  for (const k of Object.keys(fields)) {
    if (!allowed.has(k)) delete fields[k]
  }
}
