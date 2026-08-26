/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * The MySQL storage read path. Ported from
 * `packages/db-postgres/src/modules/storage/storage-queries.ts`.
 *
 * Task 10A landed the UNION ALL reconstruction path (`getDocumentById`,
 * `getDocumentByVersion`, `getDocumentHistory`) and a `findDocuments` scoped
 * to what the `versioning` + `field-types` conformance suites needed.
 *
 * Task 10B (this port) completes the surface: the `DocumentFilter[]`
 * predicate compiler (`$and`/`$or` combinators, relation hops,
 * document-column filters), `findDocuments`' `pathFilter`/`query` (LIKE
 * search)/`sort` (`LEFT JOIN LATERAL` field sort), `getDocumentByPath`,
 * `getDocumentsByVersionIds`, `getDocumentsByDocumentIds`,
 * `getPublishedVersion`, `getPublishedDocumentIds`,
 * `getDocumentCountsByStatus`, order-key / tree reads, `getCurrentPath`, and
 * `getDocumentSystemFieldsForUpdate`. `DocumentQueries` now declares
 * `implements IDocumentQueries`.
 */

import type {
  CollectionDefinition,
  CombinatorFilter,
  DocumentColumnFilter,
  DocumentFilter,
  FieldFilter,
  FieldFilterOperator,
  FieldSort,
  FlattenedFieldValue,
  FlattenedStore,
  ICollectionQueries,
  IDocumentQueries,
  MissingLocalePolicy,
  ReadMode,
  RelationFilter,
  UnifiedFieldValue,
} from '@byline/core'
import {
  ERR_DATABASE,
  ERR_NOT_FOUND,
  extractFlattenedFieldValue,
  getLogger,
  orderByContentLocale,
  resolveIdentityField,
  resolveStoreTypes,
  restoreFieldSetData,
} from '@byline/core'
import { and, desc, eq, inArray, isNotNull, isNull, type SQL, sql } from 'drizzle-orm'
import type { MySql2Database } from 'drizzle-orm/mysql2'

import {
  collections,
  currentDocumentsView,
  currentPublishedDocumentsView,
  documentAvailableLocales,
  documentPaths,
  documentRelationships,
  documents,
  documentVersionLocales,
  documentVersions,
  metaStore,
} from '../../database/schema/index.js'
import { DocumentPublishScheduleQueries } from './publish-schedules.js'
import type * as schema from '../../database/schema/index.js'
import type { DBManager } from '../../lib/db-manager.js'

type DatabaseConnection = MySql2Database<typeof schema>
// `path` was dropped from documentVersions in favour of byline_document_paths;
// SELECT projections re-attach it via a locale-aware subquery (see
// `pathProjection`), so the in-memory Document shape continues to carry it.
// `source_locale` (the per-document content-locale anchor) rides alongside so
// the locale-aware read paths re-base the fallback floor onto it rather than
// the mutable global default. See docs/08-internationalization/index.md.
// Mirrors `packages/db-postgres/src/modules/storage/storage-queries.ts`.
type Document = Omit<typeof documentVersions.$inferSelect, 'doc'> & {
  path: string | null
  source_locale: string | null
}

import { normalizeRow } from './normalize-row.js'
import {
  allStoreTypes,
  type StoreType,
  storeSelectList,
  storeTableNames,
} from './storage-store-manifest.js'
import { toDate } from './storage-utils.js'

interface MetaRow {
  type: string
  path: string
  item_id: string
  meta: Record<string, any> | null
}

/**
 * SQL references to the columns the predicate compiler may need from the
 * enclosing scope. `docVersionId` is consumed by every EXISTS subquery as
 * the correlation key; `status` / `path` / `documentId` are referenced by
 * `DocumentColumnFilter` (the inside-a-combinator form of the top-level
 * reserved keys for `status` / `path`, plus the all-scope form for `id`).
 *
 * Note: `documentId` is the *logical* document id (`document_id` on the
 * current-documents view), not `docVersionId` (the version row id) —
 * matches what callers writing `where: { id }` expect. Ports unchanged from
 * pg — dialect-agnostic shape.
 */
interface OuterScope {
  docVersionId: SQL
  documentId: SQL
  status: SQL
  path: SQL
}

/** True when `a` contains every member of `b`. */
function isSuperset<T>(a: Set<T>, b: Set<T>): boolean {
  for (const item of b) {
    if (!a.has(item)) return false
  }
  return true
}

/**
 * CollectionQueries
 *
 * Identical to pg's — a plain query-builder read against `byline_collections`,
 * with no dialect-specific SQL anywhere.
 */
export class CollectionQueries implements ICollectionQueries {
  constructor(private db: DatabaseConnection) {}

  async getAllCollections() {
    return await this.db.select().from(collections)
  }

  async getCollectionByPath(path: string) {
    return this.db.query.collections.findFirst({ where: eq(collections.path, path) })
  }

  async getCollectionById(id: string) {
    return this.db.query.collections.findFirst({ where: eq(collections.id, id) })
  }
}

/**
 * DocumentQueries
 */
export class DocumentQueries implements IDocumentQueries {
  readonly publishSchedules: DocumentPublishScheduleQueries
  private db: DatabaseConnection
  private transactionDb: DBManager
  private collections: readonly CollectionDefinition[]
  private defaultContentLocale: string
  private collectionPathCache = new Map<string, string>()

  constructor(
    db: DatabaseConnection,
    collections: readonly CollectionDefinition[],
    defaultContentLocale: string,
    transactionDb: DBManager
  ) {
    this.publishSchedules = new DocumentPublishScheduleQueries(db)
    this.db = db
    this.transactionDb = transactionDb
    this.collections = collections
    this.defaultContentLocale = defaultContentLocale
  }

  /**
   * Lock the logical document row before reading its document-grain system
   * fields. Every audited system-field writer takes this same parent-row lock,
   * so path and advertised-locale snapshots serialize without locking a
   * variable set of child rows.
   *
   * Runs on `this.transactionDb.get()` — the ambient `withTransaction`
   * executor when one is open, else the pool — so `FOR UPDATE` (unchanged
   * syntax from pg) actually takes its lock inside the caller's transaction.
   * A lock taken on a bare pool connection would release at the end of its
   * own implicit transaction and serialise nothing; see the §H ruling in the
   * Task 10B report for why `transactionDb` is a required constructor
   * parameter rather than a silently-defaulted one.
   */
  async getDocumentSystemFieldsForUpdate({
    collection_id,
    document_id,
  }: {
    collection_id: string
    document_id: string
  }): Promise<{
    source_locale: string
    path: string | null
    availableLocales: string[]
  } | null> {
    const executor = this.transactionDb.get()
    const [document] = await executor
      .select({ source_locale: documents.source_locale })
      .from(documents)
      .where(and(eq(documents.collection_id, collection_id), eq(documents.id, document_id)))
      .for('update')

    if (document == null) return null

    const [pathRow] = await executor
      .select({ path: documentPaths.path })
      .from(documentPaths)
      .where(
        and(
          eq(documentPaths.collection_id, collection_id),
          eq(documentPaths.document_id, document_id),
          eq(documentPaths.locale, document.source_locale)
        )
      )
      .limit(1)
    const localeRows = await executor
      .select({ locale: documentAvailableLocales.locale })
      .from(documentAvailableLocales)
      .where(
        and(
          eq(documentAvailableLocales.collection_id, collection_id),
          eq(documentAvailableLocales.document_id, document_id)
        )
      )

    return {
      source_locale: document.source_locale,
      path: pathRow?.path ?? null,
      availableLocales: localeRows.map((row) => row.locale).sort(),
    }
  }

  /**
   * Resolve a collection UUID to its CollectionDefinition by looking up the
   * collection's path in the DB and matching it against the injected array.
   */
  private async getDefinitionForCollection(collectionId: string): Promise<CollectionDefinition> {
    let path = this.collectionPathCache.get(collectionId)
    if (!path) {
      const row = await this.db.query.collections.findFirst({
        where: eq(collections.id, collectionId),
      })
      if (!row) {
        throw ERR_NOT_FOUND({
          message: `collection not found in database: ${collectionId}`,
          details: { collectionId },
        }).log(getLogger())
      }
      path = row.path
      this.collectionPathCache.set(collectionId, path)
    }

    const definition = this.collections.find((c) => c.path === path)
    if (!definition) {
      throw ERR_NOT_FOUND({
        message: `no CollectionDefinition found for path: ${path}`,
        details: { collectionPath: path },
      }).log(getLogger())
    }
    return definition
  }

  /**
   * Pick the Drizzle view reference to read from based on `readMode`.
   *
   *   - `'any'` (default) → `current_documents` — the latest version of
   *     each logical document, regardless of status.
   *   - `'published'`     → `current_published_documents` — the latest
   *     version whose status is `'published'`, falling back past newer
   *     drafts so public readers keep seeing previously-published
   *     content while editors work on an unpublished draft.
   *
   * Both views share the same row shape, so the returned reference is
   * drop-in substitutable at every select/where site.
   */
  private pickCurrentView(
    readMode: ReadMode | undefined
  ): typeof currentDocumentsView | typeof currentPublishedDocumentsView {
    return readMode === 'published' ? currentPublishedDocumentsView : currentDocumentsView
  }

  /**
   * Build the locale priority chain for fallback resolution:
   * `[requested, floor]`, deduplicated when both are the same. The floor is
   * the document's own `source_locale` anchor when known (so a re-anchored
   * document, or any document read after the global default is switched, falls
   * back to the locale it was actually authored in) — otherwise the configured
   * global default, which is correct for not-yet-anchored rows and for
   * row-less lookups (findByPath). See docs/08-internationalization/index.md.
   */
  private buildLocaleChain(
    requestedLocale: string | undefined,
    sourceLocale?: string | null
  ): string[] {
    const floor = sourceLocale ?? this.defaultContentLocale
    const requested = requestedLocale ?? floor
    return requested === floor ? [requested] : [requested, floor]
  }

  /**
   * Build the `onMissingLocale: 'omit'` availability gate — an EXISTS against
   * the version-locale ledger (`byline_document_version_locales`) that keeps
   * only documents available in the requested locale. The `'all'` sentinel row
   * covers locale-agnostic documents (no localized content). Returns `null`
   * when the gate does not apply — a non-`'omit'` policy (`'empty'` /
   * `'fallback'` / unset), or the admin sentinel `'all'` read — so callers can
   * conditionally push it into a WHERE. No dialect-specific SQL — ports
   * unchanged from pg.
   */
  private localeAvailabilityExists(
    versionId: SQL,
    locale: string,
    onMissingLocale: MissingLocalePolicy | undefined
  ): SQL | null {
    if (onMissingLocale !== 'omit' || locale === 'all') return null
    return sql`EXISTS (
      SELECT 1 FROM byline_document_version_locales dvl
      WHERE dvl.document_version_id = ${versionId}
        AND (dvl.locale = ${locale} OR dvl.locale = 'all')
    )`
  }

  /**
   * Batch-fetch the version-locale availability sets from the
   * `byline_document_version_locales` ledger. For each version returns the
   * concrete locales its content is complete in (`availableLocales`, in
   * configured content-locale order), or `localeAgnostic: true` when the
   * version carries only the `'all'` sentinel. Drives the
   * `_availableVersionLocales` read metadata. One indexed query per call.
   * Plain query-builder code — ports unchanged from pg.
   */
  private async getAvailableLocalesByVersion(
    versionIds: string[]
  ): Promise<Map<string, { availableLocales: string[]; localeAgnostic: boolean }>> {
    const result = new Map<string, { availableLocales: string[]; localeAgnostic: boolean }>()
    if (versionIds.length === 0) return result

    const rows = await this.db
      .select({
        vid: documentVersionLocales.document_version_id,
        locale: documentVersionLocales.locale,
      })
      .from(documentVersionLocales)
      .where(inArray(documentVersionLocales.document_version_id, versionIds))

    for (const row of rows) {
      let entry = result.get(row.vid)
      if (entry == null) {
        entry = { availableLocales: [], localeAgnostic: false }
        result.set(row.vid, entry)
      }
      if (row.locale === 'all') entry.localeAgnostic = true
      else entry.availableLocales.push(row.locale)
    }
    for (const entry of result.values()) {
      entry.availableLocales = orderByContentLocale(entry.availableLocales)
    }
    return result
  }

  /**
   * Batch-fetch the editorial advertised-locale sets from
   * `byline_document_available_locales` (document-grain). For each logical
   * document returns the set of locales the editor has elected to advertise,
   * in configured content-locale order. Surfaced on reads as
   * `availableLocales`. One indexed query per call. Plain query-builder
   * code — ports unchanged from pg.
   */
  private async getAdvertisedLocalesByDocument(
    documentIds: string[]
  ): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>()
    if (documentIds.length === 0) return result

    const rows = await this.db
      .select({
        did: documentAvailableLocales.document_id,
        locale: documentAvailableLocales.locale,
      })
      .from(documentAvailableLocales)
      .where(inArray(documentAvailableLocales.document_id, documentIds))

    for (const row of rows) {
      let arr = result.get(row.did)
      if (arr == null) {
        arr = []
        result.set(row.did, arr)
      }
      arr.push(row.locale)
    }
    for (const [did, arr] of result) result.set(did, orderByContentLocale(arr))
    return result
  }

  /**
   * Emit a SQL fragment that resolves the path string for a document via
   * the locale priority chain. Used as a projected column expression
   * inside `SELECT` lists.
   *
   * Postgres:
   * ```sql
   * (SELECT path FROM byline_document_paths
   *  WHERE document_id = <docIdSql> AND locale = ANY(<chain>)
   *  ORDER BY array_position(<chain>, locale) LIMIT 1)
   * ```
   * MySQL has no `ANY(ARRAY[...])` or `array_position` — the locale-chain
   * conversion (design spec §2): `IN (…)` for the membership test, and
   * `ORDER BY FIELD(locale, …)` for the priority order. `FIELD()` returns
   * the 1-based position of the first argument within the remaining
   * argument list (0 if absent); since the `WHERE … IN (chain)` clause
   * already restricts every candidate row to a locale that's a member of
   * the chain, `FIELD()` can never actually return 0 here — every row that
   * reaches the `ORDER BY` has a genuine position, and ascending order
   * therefore picks the earliest (highest-priority, i.e. most-requested)
   * chain entry first, exactly matching `array_position`'s semantics.
   *
   * This is a projection by known document identity, not a live-namespace
   * lookup. Deliberately do not filter `alive`: history and deleted-document
   * administration must continue to display the retained path.
   *
   * Verified live against MySQL 9.7.1 (see the Task 10A report) and pinned
   * by `storage-queries.test.ts`'s locale-chain-ordering test.
   */
  private pathProjection(
    documentIdCol: SQL,
    requestedLocale?: string,
    sourceLocaleCol?: SQL
  ): SQL<string | null> {
    const floorSql: SQL = sourceLocaleCol
      ? sql`COALESCE(${sourceLocaleCol}, ${this.defaultContentLocale})`
      : sql`${this.defaultContentLocale}`
    const requestedSql: SQL = requestedLocale != null ? sql`${requestedLocale}` : floorSql
    const chainSql = sql.join([requestedSql, floorSql], sql`, `)
    return sql<string | null>`(
      SELECT ${documentPaths.path} FROM ${documentPaths}
      WHERE ${documentPaths.document_id} = ${documentIdCol}
        AND ${documentPaths.locale} IN (${chainSql})
      ORDER BY FIELD(${documentPaths.locale}, ${chainSql})
      LIMIT 1
    )`
  }

  /**
   * Emit a SQL fragment that resolves a `(collection_id, path)` tuple to a
   * `document_id` via the locale priority chain. Used inside `WHERE` clauses
   * for findByPath-style lookups. Same `IN (…)` / `FIELD()` locale-chain
   * conversion as `pathProjection` — see that method's docblock. Returns
   * NULL when no row matches in any locale, which makes the outer `=`
   * predicate fail cleanly (no document found).
   */
  private resolveDocumentIdByPath(
    collection_id: string,
    path: string,
    requestedLocale?: string
  ): SQL {
    const chain = this.buildLocaleChain(requestedLocale)
    const chainSql = sql.join(
      chain.map((l) => sql`${l}`),
      sql`, `
    )
    return sql`(
      SELECT ${documentPaths.document_id} FROM ${documentPaths}
      WHERE ${documentPaths.collection_id} = ${collection_id}
        AND ${documentPaths.path} = ${path}
        AND ${documentPaths.alive} = true
        AND ${documentPaths.locale} IN (${chainSql})
      ORDER BY FIELD(${documentPaths.locale}, ${chainSql})
      LIMIT 1
    )`
  }

  /**
   * Project list for `current_documents` / `current_published_documents`
   * reads, with `path` resolved through the locale priority chain. Used
   * everywhere a read previously did `.select()` (which auto-pulls every
   * view column) — `path` is no longer projected by the views, so call
   * sites must list the projection explicitly.
   */
  private viewProjection(
    view: typeof currentDocumentsView | typeof currentPublishedDocumentsView,
    requestedLocale: string | undefined
  ) {
    return {
      id: view.id,
      document_id: view.document_id,
      collection_id: view.collection_id,
      collection_version: view.collection_version,
      event_type: view.event_type,
      status: view.status,
      is_deleted: view.is_deleted,
      created_at: view.created_at,
      updated_at: view.updated_at,
      created_by: view.created_by,
      change_summary: view.change_summary,
      source_locale: view.source_locale,
      path: this.pathProjection(
        sql`${view.document_id}`,
        requestedLocale,
        sql`${view.source_locale}`
      ),
    }
  }

  /**
   * Project list for direct `byline_document_versions` reads (history,
   * version-by-id lookups). Mirrors `viewProjection` but against the
   * underlying table — `path` is sourced from `byline_document_paths` via
   * the locale priority chain, since it no longer lives on the version row.
   */
  private documentVersionsProjection(requestedLocale: string | undefined) {
    const sourceLocaleSql = sql<
      string | null
    >`(SELECT source_locale FROM byline_documents WHERE id = ${documentVersions.document_id})`
    return {
      id: documentVersions.id,
      document_id: documentVersions.document_id,
      collection_id: documentVersions.collection_id,
      collection_version: documentVersions.collection_version,
      event_type: documentVersions.event_type,
      status: documentVersions.status,
      is_deleted: documentVersions.is_deleted,
      created_at: documentVersions.created_at,
      updated_at: documentVersions.updated_at,
      created_by: documentVersions.created_by,
      change_summary: documentVersions.change_summary,
      source_locale: sourceLocaleSql,
      path: this.pathProjection(
        sql`${documentVersions.document_id}`,
        requestedLocale,
        sourceLocaleSql
      ),
    }
  }

  /**
   * Resolve the single effective content locale a version should be restored
   * in, walking the fallback chain (`[requested, default]`) and returning the
   * first locale the version is *available* in. Pure JS/data-structure code
   * — no SQL — ports unchanged from pg. See pg's docblock for the full
   * phase-1 availability rule.
   */
  private resolveEffectiveLocale(flattenedData: FlattenedFieldValue[], chain: string[]): string {
    // biome-ignore lint/style/noNonNullAssertion: chain is non-empty by construction
    const defaultLocale = chain[chain.length - 1]!

    const pathsByLocale = new Map<string, Set<string>>()
    for (const row of flattenedData) {
      if (row.locale === 'all' || row.field_type === 'meta') continue
      let set = pathsByLocale.get(row.locale)
      if (set == null) {
        set = new Set<string>()
        pathsByLocale.set(row.locale, set)
      }
      set.add(row.field_path.join('.'))
    }

    const canonical = pathsByLocale.get(defaultLocale) ?? new Set<string>()

    for (const candidate of chain) {
      if (candidate === defaultLocale) break
      if (canonical.size === 0) return candidate
      const covered = pathsByLocale.get(candidate)
      if (covered != null && isSuperset(covered, canonical)) return candidate
    }

    return defaultLocale
  }

  /**
   * Reconstruct document fields from unified row values using schema-aware
   * restoration. Meta rows (from store_meta) are converted to
   * FlattenedFieldValue entries so that restoreFieldSetData can inject
   * _id and _type for blocks and array items inline. Pure JS/core-delegate
   * code — ports unchanged from pg.
   */
  private reconstructFromUnifiedRows(
    unifiedFieldValues: UnifiedFieldValue[],
    definition: CollectionDefinition,
    locale: string,
    metaRows?: MetaRow[],
    lenient = false,
    onMissingLocale?: MissingLocalePolicy,
    sourceLocale?: string | null
  ): { fields: any; warnings: string[] } {
    const flattenedData: FlattenedFieldValue[] = unifiedFieldValues.map((row) =>
      extractFlattenedFieldValue(row)
    )

    if (metaRows) {
      for (const meta of metaRows) {
        flattenedData.push({
          locale: 'all',
          field_path: meta.path.split('.'),
          field_type: 'meta',
          type: meta.type as 'group' | 'array_item',
          item_id: meta.item_id,
        })
      }
    }

    const resolveLocale =
      locale === 'all'
        ? undefined
        : onMissingLocale === 'fallback'
          ? this.resolveEffectiveLocale(flattenedData, this.buildLocaleChain(locale, sourceLocale))
          : locale
    const { data, warnings } = restoreFieldSetData(definition.fields, flattenedData, resolveLocale)

    if (!lenient && warnings.length > 0) {
      throw ERR_DATABASE({
        message: `document reconstruction failed with ${warnings.length} warnings`,
        details: { warnings },
      }).log(getLogger())
    }

    return { fields: data, warnings }
  }

  /**
   * getCurrentVersionMetadata — narrow metadata fetch for the current version.
   *
   * Hits `current_documents` only; no field reconstruction, no meta fetch,
   * no path subquery. Used by lifecycle operations (status changes,
   * restore, delete checks) that only need `document_version_id` /
   * `status` / timestamps before mutating.
   */
  async getCurrentVersionMetadata({
    collection_id,
    document_id,
  }: {
    collection_id: string
    document_id: string
  }): Promise<{
    document_version_id: string
    document_id: string
    collection_id: string
    status: string
    created_at: Date
    updated_at: Date
  } | null> {
    const [row] = await this.db
      .select({
        document_version_id: currentDocumentsView.id,
        document_id: currentDocumentsView.document_id,
        collection_id: currentDocumentsView.collection_id,
        status: currentDocumentsView.status,
        created_at: currentDocumentsView.created_at,
        updated_at: currentDocumentsView.updated_at,
      })
      .from(currentDocumentsView)
      .where(
        and(
          eq(currentDocumentsView.collection_id, collection_id),
          eq(currentDocumentsView.document_id, document_id)
        )
      )
      .limit(1)

    if (!row) return null

    return {
      document_version_id: row.document_version_id,
      document_id: row.document_id,
      collection_id: row.collection_id ?? '',
      status: row.status ?? 'draft',
      created_at: row.created_at ?? new Date(),
      updated_at: row.updated_at ?? new Date(),
    }
  }

  /**
   * getCurrentPath — resolve a document's canonical (source-locale) path.
   *
   * Reuses `pathProjection` against `current_documents`, passing
   * `requestedLocale: undefined` so the projection's fallback floor — the
   * document's own `source_locale` (COALESCE-guarded to the default content
   * locale for not-yet-anchored rows) — supplies the canonical path. Used by
   * the lifecycle to populate `path` on the status-change / unpublish hook
   * contexts. Returns `null` when no path row (or document) exists.
   */
  async getCurrentPath({
    collection_id,
    document_id,
  }: {
    collection_id: string
    document_id: string
  }): Promise<string | null> {
    const [row] = await this.db
      .select({
        path: this.pathProjection(
          sql`${currentDocumentsView.document_id}`,
          undefined,
          sql`${currentDocumentsView.source_locale}`
        ),
      })
      .from(currentDocumentsView)
      .where(
        and(
          eq(currentDocumentsView.collection_id, collection_id),
          eq(currentDocumentsView.document_id, document_id)
        )
      )
      .limit(1)

    return row?.path ?? null
  }

  /**
   * getDocumentById — gets the current version of a document by its logical document ID.
   *
   * When `lenient` is true, schema-mismatch warnings emitted during
   * reconstruction are surfaced on the returned object as `restoreWarnings`
   * rather than thrown. This is the admin edit path's "best-effort load"
   * mode for documents written under a previous collection schema.
   */
  async getDocumentById({
    collection_id,
    document_id,
    locale = 'en',
    reconstruct = true,
    readMode,
    filters,
    lenient = false,
    onMissingLocale,
  }: {
    collection_id: string
    document_id: string
    locale?: string
    reconstruct?: boolean
    readMode?: ReadMode
    filters?: DocumentFilter[]
    lenient?: boolean
    onMissingLocale?: MissingLocalePolicy
  }) {
    const view = this.pickCurrentView(readMode)
    const baseConditions: SQL[] = [
      eq(view.collection_id, collection_id),
      eq(view.document_id, document_id),
    ]
    if (filters?.length) {
      const outerScope: OuterScope = {
        docVersionId: sql`${view.id}`,
        documentId: sql`${view.document_id}`,
        status: sql`${view.status}`,
        path: this.pathProjection(sql`${view.document_id}`, locale, sql`${view.source_locale}`),
      }
      for (const f of filters) {
        baseConditions.push(this.buildFilterExists(f, locale, outerScope, readMode, 0))
      }
    }
    const strictGate = this.localeAvailabilityExists(sql`${view.id}`, locale, onMissingLocale)
    if (strictGate) {
      baseConditions.push(strictGate)
    }
    const [document] = await this.db
      .select(this.viewProjection(view, locale))
      .from(view)
      .where(and(...baseConditions))

    if (document == null) {
      return null
    }

    const unifiedFieldValues = await this.getAllFieldValues(
      document.id,
      locale,
      document.source_locale
    )

    if (reconstruct === true) {
      const definition = await this.getDefinitionForCollection(collection_id)

      const metaRows = await this.db
        .select({
          type: metaStore.type,
          path: metaStore.path,
          item_id: metaStore.item_id,
          meta: metaStore.meta,
        })
        .from(metaStore)
        .where(eq(metaStore.document_version_id, document.id))

      const { fields, warnings } = this.reconstructFromUnifiedRows(
        unifiedFieldValues,
        definition,
        locale,
        metaRows as MetaRow[],
        lenient,
        onMissingLocale,
        document.source_locale
      )

      const availability = (await this.getAvailableLocalesByVersion([document.id])).get(document.id)
      const advertised = (await this.getAdvertisedLocalesByDocument([document.document_id])).get(
        document.document_id
      )

      return {
        document_version_id: document.id,
        document_id: document.document_id,
        path: document.path ?? '',
        source_locale: document.source_locale ?? null,
        status: document.status,
        event_type: document.event_type,
        created_at: document.created_at,
        updated_at: document.updated_at,
        created_by: document.created_by ?? null,
        fields,
        availableLocales: advertised ?? [],
        _availableVersionLocales: availability?.availableLocales ?? [],
        _localeAgnostic: availability?.localeAgnostic ?? false,
        ...(lenient && warnings.length > 0 ? { restoreWarnings: warnings } : {}),
      }
    }
    const fieldValues = this.convertUnionRowToFlattenedStores(unifiedFieldValues)
    return {
      document_version_id: document.id,
      document_id: document.document_id,
      path: document.path ?? '',
      source_locale: document.source_locale ?? null,
      status: document.status,
      event_type: document.event_type,
      created_at: document.created_at,
      updated_at: document.updated_at,
      created_by: document.created_by ?? null,
      fields: fieldValues,
    }
  }

  /**
   * getDocumentByPath — resolves `(collection_id, path)` through the locale
   * priority chain to a document_id, then reads and reconstructs its
   * current version. See `resolveDocumentIdByPath` for the locale-chain
   * SQL.
   */
  async getDocumentByPath({
    collection_id,
    path,
    locale = 'en',
    reconstruct = true,
    readMode,
    filters,
    onMissingLocale,
  }: {
    collection_id: string
    path: string
    locale?: string
    reconstruct: boolean
    readMode?: ReadMode
    filters?: DocumentFilter[]
    onMissingLocale?: MissingLocalePolicy
  }) {
    const view = this.pickCurrentView(readMode)
    const baseConditions: SQL[] = [
      eq(view.collection_id, collection_id),
      sql`${view.document_id} = ${this.resolveDocumentIdByPath(collection_id, path, locale)}`,
    ]
    if (filters?.length) {
      const outerScope: OuterScope = {
        docVersionId: sql`${view.id}`,
        documentId: sql`${view.document_id}`,
        status: sql`${view.status}`,
        path: this.pathProjection(sql`${view.document_id}`, locale, sql`${view.source_locale}`),
      }
      for (const f of filters) {
        baseConditions.push(this.buildFilterExists(f, locale, outerScope, readMode, 0))
      }
    }
    const strictGate = this.localeAvailabilityExists(sql`${view.id}`, locale, onMissingLocale)
    if (strictGate) {
      baseConditions.push(strictGate)
    }
    const [document] = await this.db
      .select(this.viewProjection(view, locale))
      .from(view)
      .where(and(...baseConditions))

    if (document == null) {
      return null
    }

    const unifiedFieldValues = await this.getAllFieldValues(
      document.id,
      locale,
      document.source_locale
    )

    if (reconstruct === true) {
      const definition = await this.getDefinitionForCollection(collection_id)

      const metaRows = await this.db
        .select({
          type: metaStore.type,
          path: metaStore.path,
          item_id: metaStore.item_id,
          meta: metaStore.meta,
        })
        .from(metaStore)
        .where(eq(metaStore.document_version_id, document.id))

      const { fields } = this.reconstructFromUnifiedRows(
        unifiedFieldValues,
        definition,
        locale,
        metaRows as MetaRow[],
        false,
        onMissingLocale,
        document.source_locale
      )

      const availability = (await this.getAvailableLocalesByVersion([document.id])).get(document.id)
      const advertised = (await this.getAdvertisedLocalesByDocument([document.document_id])).get(
        document.document_id
      )

      return {
        document_version_id: document.id,
        document_id: document.document_id,
        path: document.path ?? '',
        source_locale: document.source_locale ?? null,
        status: document.status,
        event_type: document.event_type,
        created_at: document.created_at,
        updated_at: document.updated_at,
        created_by: document.created_by ?? null,
        fields,
        availableLocales: advertised ?? [],
        _availableVersionLocales: availability?.availableLocales ?? [],
        _localeAgnostic: availability?.localeAgnostic ?? false,
      }
    }
    const fieldValues = this.convertUnionRowToFlattenedStores(unifiedFieldValues)
    return {
      document_version_id: document.id,
      document_id: document.document_id,
      path: document.path ?? '',
      source_locale: document.source_locale ?? null,
      status: document.status,
      event_type: document.event_type,
      created_at: document.created_at,
      updated_at: document.updated_at,
      created_by: document.created_by ?? null,
      fields: fieldValues,
    }
  }

  /**
   * getDocumentByVersion — fetches a specific version and reconstructs its fields.
   */
  async getDocumentByVersion({
    document_version_id,
    document_id,
    locale = 'all',
    collection_id,
    filters,
  }: {
    document_version_id: string
    document_id?: string
    locale?: string
    collection_id?: string
    filters?: DocumentFilter[]
  }): Promise<any | null> {
    const projectionLocale = locale === 'all' ? undefined : locale
    const filterLocale = projectionLocale ?? this.defaultContentLocale
    const conditions: SQL[] = [eq(documentVersions.id, document_version_id)]
    if (document_id) conditions.push(eq(documentVersions.document_id, document_id))
    if (collection_id) conditions.push(eq(documentVersions.collection_id, collection_id))
    if (filters?.length) {
      const scope: OuterScope = {
        docVersionId: sql`${documentVersions.id}`,
        documentId: sql`${documentVersions.document_id}`,
        status: sql`${documentVersions.status}`,
        path: this.pathProjection(sql`${documentVersions.document_id}`, filterLocale),
      }
      for (const filter of filters) {
        conditions.push(this.buildFilterExists(filter, filterLocale, scope, 'any', 0))
      }
    }
    const [document] = await this.db
      .select(this.documentVersionsProjection(projectionLocale))
      .from(documentVersions)
      .where(and(...conditions))

    if (document == null) return null

    const unifiedFieldValues = await this.getAllFieldValues(
      document.id,
      locale,
      document.source_locale
    )
    const definition = await this.getDefinitionForCollection(document.collection_id)

    const metaRows = await this.db
      .select({
        type: metaStore.type,
        path: metaStore.path,
        item_id: metaStore.item_id,
        meta: metaStore.meta,
      })
      .from(metaStore)
      .where(eq(metaStore.document_version_id, document.id))

    const { fields } = this.reconstructFromUnifiedRows(
      unifiedFieldValues,
      definition,
      locale,
      metaRows as MetaRow[],
      false,
      undefined,
      document.source_locale
    )

    return {
      document_version_id: document.id,
      document_id: document.document_id,
      path: document.path ?? '',
      source_locale: document.source_locale ?? null,
      status: document.status,
      created_at: document.created_at,
      updated_at: document.updated_at,
      fields,
    }
  }

  /**
   * getDocumentsByVersionIds — fetches and reconstructs multiple documents by
   * version ID. Used for batch loading a known set of versions (e.g.
   * migration scripts, tests).
   */
  async getDocumentsByVersionIds({
    document_version_ids,
    locale = 'all',
  }: {
    document_version_ids: string[]
    locale?: string
  }): Promise<any[]> {
    if (document_version_ids.length === 0) return []

    const docs = await this.db
      .select(this.documentVersionsProjection(locale === 'all' ? undefined : locale))
      .from(documentVersions)
      .where(inArray(documentVersions.id, document_version_ids))

    return this.reconstructDocuments({ documents: docs as Document[], locale })
  }

  /**
   * getDocumentsByDocumentIds — batch-fetch current versions for a list of
   * logical document IDs, with optional selective field loading.
   *
   * Resolves each document_id to its current version via the
   * `current_documents` view (soft-deleted documents are excluded by the
   * view definition), then delegates to `reconstructDocuments` for the
   * shared field + meta reconstruction path.
   *
   * Primary consumer is the client API's relationship populate pass —
   * `store_relation` rows carry `target_document_id` (not version ID), so
   * populate collects those IDs and resolves them here in one round trip.
   */
  async getDocumentsByDocumentIds({
    collection_id,
    document_ids,
    locale = 'all',
    fields,
    readMode,
    filters,
  }: {
    collection_id: string
    document_ids: string[]
    locale?: string
    fields?: string[]
    readMode?: ReadMode
    filters?: DocumentFilter[]
  }): Promise<any[]> {
    if (document_ids.length === 0) return []

    const view = this.pickCurrentView(readMode)
    // The locale used to compile filter EXISTS subqueries should resolve
    // values from a real locale, even when the surrounding read uses the
    // sentinel `'all'` (populate batches that span every locale do this).
    // Falling back to the installation default here matches the default
    // used by the single-doc lookup methods.
    const filterLocale = locale === 'all' ? this.defaultContentLocale : locale
    const baseConditions: SQL[] = [
      eq(view.collection_id, collection_id),
      inArray(view.document_id, document_ids),
    ]
    if (filters?.length) {
      const outerScope: OuterScope = {
        docVersionId: sql`${view.id}`,
        documentId: sql`${view.document_id}`,
        status: sql`${view.status}`,
        path: this.pathProjection(
          sql`${view.document_id}`,
          filterLocale,
          sql`${view.source_locale}`
        ),
      }
      for (const f of filters) {
        baseConditions.push(this.buildFilterExists(f, filterLocale, outerScope, readMode, 0))
      }
    }
    const docs = await this.db
      .select(this.viewProjection(view, filterLocale))
      .from(view)
      .where(and(...baseConditions))

    // Populated relation targets always fall back through the locale chain so
    // a populated tree never has holes — independent of the outer read's
    // `onMissingLocale`. (A no-op when `locale === 'all'`, which keeps the map.)
    return this.reconstructDocuments({
      documents: docs as Document[],
      locale,
      fields,
      onMissingLocale: 'fallback',
    })
  }

  /**
   * getDocumentHistory — paginated version history for a document,
   * including soft-deleted versions.
   */
  async getDocumentHistory({
    collection_id,
    document_id,
    locale = 'all',
    page = 1,
    page_size = 20,
    order = 'updated_at',
    desc: descending = true,
    filters,
  }: {
    collection_id: string
    document_id: string
    locale?: string
    page?: number
    page_size?: number
    order?: string
    desc?: boolean
    query?: string
    filters?: DocumentFilter[]
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
    const collection = await this.db.query.collections.findFirst({
      where: eq(collections.id, collection_id),
    })

    if (collection == null || collection.config == null) {
      throw ERR_NOT_FOUND({
        message: `collection not found or missing config: ${collection_id}`,
        details: { collectionId: collection_id },
      }).log(getLogger())
    }

    const filterLocale = locale === 'all' ? this.defaultContentLocale : locale
    const conditions: SQL[] = [
      eq(documentVersions.collection_id, collection_id),
      eq(documentVersions.document_id, document_id),
    ]
    if (filters?.length) {
      const scope: OuterScope = {
        docVersionId: sql`${documentVersions.id}`,
        documentId: sql`${documentVersions.document_id}`,
        status: sql`${documentVersions.status}`,
        path: this.pathProjection(sql`${documentVersions.document_id}`, filterLocale),
      }
      for (const filter of filters) {
        conditions.push(this.buildFilterExists(filter, filterLocale, scope, 'any', 0))
      }
    }

    // `count(*)::int` (pg) → `CAST(COUNT(*) AS SIGNED)` (design spec §2),
    // with the `Number()` normalisation at the result edge kept as a belt.
    const totalResult: { count: number }[] = await this.db
      .select({ count: sql<number>`CAST(COUNT(*) AS SIGNED)` })
      .from(documentVersions)
      .where(and(...conditions))

    const total = Number(totalResult[0]?.count) || 0
    const total_pages = Math.ceil(total / page_size)
    const offset = (page - 1) * page_size
    // History is per-document; path is sticky so every version row has the
    // same value. `order === 'path'` is degenerate and was removed when
    // path moved to byline_document_paths — fall back to created_at.
    const orderColumn = documentVersions.created_at
    const orderFunc = descending === true ? sql`DESC` : sql`ASC`

    const projectionLocale = locale === 'all' ? undefined : locale
    const result: Document[] = await this.db
      .select(this.documentVersionsProjection(projectionLocale))
      .from(documentVersions)
      .where(and(...conditions))
      .orderBy(sql`${orderColumn} ${orderFunc}`)
      .limit(page_size)
      .offset(offset)

    const history = await this.reconstructDocuments({ documents: result, locale })

    return {
      documents: history,
      meta: { total, page, page_size, total_pages, order, desc: descending },
    }
  }

  /**
   * getPublishedVersion
   *
   * Find the latest version of a document that has a specific status
   * (defaults to 'published'). Queries `document_versions` directly so it
   * can find a published version even when a newer draft exists.
   *
   * Returns minimal version metadata (not reconstructed content), or null
   * if no version with the requested status exists.
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
    const [row] = await this.db
      .select({
        document_version_id: documentVersions.id,
        document_id: documentVersions.document_id,
        status: documentVersions.status,
        created_at: documentVersions.created_at,
        updated_at: documentVersions.updated_at,
      })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.collection_id, collection_id),
          eq(documentVersions.document_id, document_id),
          eq(documentVersions.status, status),
          eq(documentVersions.is_deleted, false)
        )
      )
      .orderBy(sql`${documentVersions.id} DESC`)
      .limit(1)

    if (!row) return null

    return {
      document_version_id: row.document_version_id,
      document_id: row.document_id,
      status: row.status ?? 'draft',
      created_at: row.created_at ?? new Date(),
      updated_at: row.updated_at ?? new Date(),
    }
  }

  /**
   * getPublishedDocumentIds
   *
   * Given a list of document IDs, return the subset that have at least one
   * version with the requested status (defaults to 'published'). Uses a
   * single batch query instead of per-document lookups.
   */
  async getPublishedDocumentIds({
    collection_id,
    document_ids,
    status = 'published',
  }: {
    collection_id: string
    document_ids: string[]
    status?: string
  }): Promise<Set<string>> {
    if (document_ids.length === 0) return new Set()

    const rows = await this.db
      .select({ document_id: documentVersions.document_id })
      .from(documentVersions)
      .where(
        and(
          inArray(documentVersions.document_id, document_ids),
          eq(documentVersions.collection_id, collection_id),
          eq(documentVersions.status, status),
          eq(documentVersions.is_deleted, false)
        )
      )
      .groupBy(documentVersions.document_id)

    return new Set(rows.map((r) => r.document_id))
  }

  /**
   * getLastOrderKey
   *
   * Largest `order_key` currently in use for the given collection. Used
   * at create-time on `orderable: true` collections to append the new
   * row at the end. Returns `null` when no keyed rows exist yet.
   */
  async getLastOrderKey({ collection_id }: { collection_id: string }): Promise<string | null> {
    const rows = await this.db
      .select({ order_key: documents.order_key })
      .from(documents)
      .where(and(eq(documents.collection_id, collection_id), isNotNull(documents.order_key)))
      .orderBy(desc(documents.order_key))
      .limit(1)
    return rows[0]?.order_key ?? null
  }

  /**
   * getNeighborOrderKeys
   *
   * Resolve the `order_key` values bracketing a target gap in one query.
   * `before_document_id` is the doc the moved row should land *after*;
   * `after_document_id` is the doc it should land *before*. Either or
   * both may be null (append / prepend / empty collection).
   *
   * Resolves both keys in a single round trip to keep the read consistent
   * with the next-key computation that follows in the caller.
   */
  async getNeighborOrderKeys({
    collection_id,
    before_document_id,
    after_document_id,
  }: {
    collection_id: string
    before_document_id: string | null
    after_document_id: string | null
  }): Promise<{ left: string | null; right: string | null }> {
    const ids: string[] = []
    if (before_document_id) ids.push(before_document_id)
    if (after_document_id) ids.push(after_document_id)
    if (ids.length === 0) {
      return { left: null, right: null }
    }
    const rows = await this.db
      .select({ id: documents.id, order_key: documents.order_key })
      .from(documents)
      .where(and(eq(documents.collection_id, collection_id), inArray(documents.id, ids)))
    const byId = new Map(rows.map((r) => [r.id, r.order_key]))
    return {
      left: before_document_id ? (byId.get(before_document_id) ?? null) : null,
      right: after_document_id ? (byId.get(after_document_id) ?? null) : null,
    }
  }

  /**
   * getCanonicalDocumentOrder
   *
   * Returns every document in the collection in its canonical list-view
   * order: `order_key ASC NULLS LAST, created_at DESC`. Used by the reorder
   * server fn for backfill and recovery from key corruption.
   *
   * Divergence from pg: MySQL has no `NULLS LAST`. MySQL's own `ASC`
   * default sorts NULL *first* (the opposite of pg's `NULLS LAST`), so the
   * `(col IS NULL) ASC, col ASC` emulation idiom — the same one
   * `buildDocumentOrderClause` uses — is required here too.
   */
  async getCanonicalDocumentOrder({
    collection_id,
  }: {
    collection_id: string
  }): Promise<Array<{ id: string; order_key: string | null }>> {
    const rows = await this.db
      .select({ id: documents.id, order_key: documents.order_key })
      .from(documents)
      .where(eq(documents.collection_id, collection_id))
      .orderBy(
        sql`(${documents.order_key} IS NULL) ASC, ${documents.order_key} ASC`,
        desc(documents.created_at)
      )
    return rows
  }

  /**
   * getTreeAncestors — see {@link IDocumentQueries.getTreeAncestors}.
   *
   * Recursive CTE walking `parent_document_id` upward from the given node.
   * Returns ancestors root-first (`ORDER BY depth DESC`), each with a 1-based
   * depth (1 = immediate parent). Empty for a root or unplaced node.
   *
   * Status-at-edge: in `published` mode each hop must resolve in
   * `byline_current_published_documents`, so the walk stops at the first
   * unpublished ancestor rather than skipping it (a truncated spine the splat
   * handler turns into a 404). `any` mode walks the raw edges unchanged.
   *
   * `WITH RECURSIVE` syntax is unchanged from pg (the 8.0.14 engine floor
   * guarantees support); the `::uuid` cast on `document_id` is dropped —
   * MySQL has no cast syntax for a UUID-shaped `CHAR(36)` column, and the
   * driver already binds the plain string correctly.
   */
  async getTreeAncestors({
    document_id,
    maxDepth = 10_000,
    readMode = 'any',
    locale = this.defaultContentLocale,
    filters,
  }: {
    document_id: string
    maxDepth?: number
    readMode?: ReadMode
    locale?: string
    filters?: DocumentFilter[]
  }): Promise<Array<{ document_id: string; depth: number }>> {
    const childGate = this.buildTreeVisibility(
      sql`child_document_id`,
      filters,
      locale,
      readMode,
      'cv0'
    )
    const anchorParentGate = this.buildTreeVisibility(
      sql`parent_document_id`,
      filters,
      locale,
      readMode,
      'pv0'
    )
    const recursiveParentGate = this.buildTreeVisibility(
      sql`r.parent_document_id`,
      filters,
      locale,
      readMode,
      'pv1'
    )

    const query = sql`
      WITH RECURSIVE ancestors AS (
        SELECT parent_document_id AS ancestor_id, child_document_id AS node_id, 1 AS depth
        FROM byline_document_relationships
        WHERE child_document_id = ${document_id} AND parent_document_id IS NOT NULL
          AND ${childGate}
          AND ${anchorParentGate}
        UNION ALL
        SELECT r.parent_document_id, r.child_document_id, a.depth + 1
        FROM byline_document_relationships r
        JOIN ancestors a ON r.child_document_id = a.ancestor_id
        WHERE r.parent_document_id IS NOT NULL AND a.depth < ${maxDepth}
          AND ${recursiveParentGate}
      )
      SELECT ancestor_id AS document_id, depth FROM ancestors ORDER BY depth DESC
    `
    const result = (await this.db.execute(query)) as unknown as [
      Array<{ document_id: string; depth: number }>,
      unknown,
    ]
    return result[0].map((r) => ({
      document_id: r.document_id as string,
      depth: Number(r.depth),
    }))
  }

  /**
   * getTreeChildren — see {@link IDocumentQueries.getTreeChildren}.
   *
   * Immediate children of a node ordered by the per-parent `order_key`.
   * `parentDocumentId: null` returns the collection's root nodes; the join to
   * `byline_documents` scopes roots to the collection (they have no parent to
   * scope by). Plain query-builder code — ports unchanged from pg.
   */
  async getTreeChildren({
    collectionId,
    parentDocumentId,
  }: {
    collectionId: string
    parentDocumentId: string | null
  }): Promise<Array<{ document_id: string; order_key: string }>> {
    const rows = await this.db
      .select({
        document_id: documentRelationships.child_document_id,
        order_key: documentRelationships.order_key,
      })
      .from(documentRelationships)
      .innerJoin(documents, eq(documents.id, documentRelationships.child_document_id))
      .where(
        and(
          eq(documents.collection_id, collectionId),
          parentDocumentId == null
            ? isNull(documentRelationships.parent_document_id)
            : eq(documentRelationships.parent_document_id, parentDocumentId)
        )
      )
      .orderBy(documentRelationships.order_key)
    return rows
  }

  /**
   * getTreeParent — see {@link IDocumentQueries.getTreeParent}.
   *
   * Single indexed lookup on the edge table by `child_document_id` (unique).
   * No row → *unplaced*; a row with a null parent → *root*; a row with a parent
   * → *child*. Distinguishes the unplaced/root states that `getTreeAncestors`
   * (which returns `[]` for both) conflates. `::uuid` cast dropped, same as
   * `getTreeAncestors`.
   */
  async getTreeParent({
    document_id,
    readMode = 'any',
    locale = this.defaultContentLocale,
    filters,
  }: {
    document_id: string
    readMode?: ReadMode
    locale?: string
    filters?: DocumentFilter[]
  }): Promise<{ placed: boolean; parentDocumentId: string | null; parentRedacted?: true }> {
    const childGate = this.buildTreeVisibility(
      sql`r.child_document_id`,
      filters,
      locale,
      readMode,
      'cv0'
    )
    const parentGate = this.buildTreeVisibility(
      sql`r.parent_document_id`,
      filters,
      locale,
      readMode,
      'pv0'
    )
    const query = sql`
      SELECT r.parent_document_id,
             CASE WHEN r.parent_document_id IS NULL THEN TRUE ELSE ${parentGate} END AS parent_visible
      FROM byline_document_relationships r
      WHERE r.child_document_id = ${document_id}
        AND ${childGate}
      LIMIT 1
    `
    const result = (await this.db.execute(query)) as unknown as [
      Array<{ parent_document_id: string | null; parent_visible: number | boolean }>,
      unknown,
    ]
    const row = result[0][0]
    if (row == null) return { placed: false, parentDocumentId: null }
    if (!row.parent_visible) {
      return { placed: true, parentDocumentId: null, parentRedacted: true }
    }
    return { placed: true, parentDocumentId: row.parent_document_id ?? null }
  }

  /**
   * getTreeSubtree — see {@link IDocumentQueries.getTreeSubtree}.
   *
   * Recursive CTE descending from the requested root (or the collection's
   * roots when `rootDocumentId` is null). Each row carries a `/`-joined path
   * of ancestor `order_key`s; ordering by that path yields a pre-order
   * depth-first walk (a parent's path is a prefix of its children's, and `/`
   * (0x2F) sorts below every key character in an ascii_bin comparison).
   * Status-at-edge: every node — anchor included — must exist in the chosen
   * current-documents view, so an unpublished node and its whole subtree
   * drop out in `published` mode.
   *
   * Three divergences from pg, all found (or, for the third, reproduced)
   * live — not assumed from docs:
   *
   *   - `s.path || '/' || r.order_key` (pg's `||` string concat) is MySQL
   *     boolean OR unless `PIPES_AS_CONCAT` is in `sql_mode` — confirmed
   *     against this database's `@@sql_mode` (it isn't set), and confirmed
   *     `SELECT 'a' || 'b'` returns `0`, not `'ab'`. `CONCAT(s.path, '/',
   *     r.order_key)` is the portable form.
   *   - `ORDER BY path COLLATE "C"` drops the explicit collation: `order_key`
   *     (and therefore the CONCAT'd `path` column, once the width fix below
   *     is in place) is already `ascii_bin` — byte-comparable — end to end
   *     (`varcharByteSorted`, `database/schema/common.ts`), confirmed live
   *     that `CONCAT()` over two `ascii_bin` operands plus a `'/'` literal
   *     stays `ascii_bin` rather than falling back to the connection's
   *     `utf8mb4_0900_ai_ci` default (which would reorder mixed-case keys
   *     incorrectly, the same class of bug `varcharByteSorted` exists to
   *     prevent on the base columns).
   *   - pg's `r.order_key::text AS path` cast does **two** jobs, not one —
   *     an earlier version of this docblock dropped the cast on collation
   *     grounds alone and missed the second job. In Postgres, `::text`
   *     also makes the anchor column **unbounded** (`text` has no length
   *     cap), which an accumulating concatenation needs. MySQL infers a
   *     recursive CTE's column types from the *non-recursive* (anchor) leg
   *     only — a bare `r.order_key` reference in the anchor makes `path`
   *     inherit `order_key`'s declared `varchar(128)` width
   *     (`varcharByteSorted`, `database/schema/index.ts:299`), so every
   *     recursive iteration's `CONCAT` is silently constrained to 128
   *     bytes regardless of how the SELECT list is written. Reproduced
   *     live against this server (`STRICT_TRANS_TABLES` is in `sql_mode`,
   *     so it's a hard `ER_DATA_TOO_LONG`, not silent truncation):
   *     `WITH RECURSIVE t AS (SELECT CAST('ab' AS CHAR(128) CHARACTER SET
   *     ascii) AS p, 1 AS n UNION ALL SELECT CONCAT(p,'/','abc…xyz'), n+1
   *     FROM t WHERE n<6) …` → `ERROR 1406 (22001): Data too long for
   *     column 'p' at row 1`. The threshold — `Σ len(order_key) + depth − 1
   *     > 128` — is far more reachable than the `cte_max_recursion_depth`
   *     ceiling this method's own docblock elsewhere flags: roughly 11–40
   *     tree levels for typical fractional-index keys, lower once keys
   *     have grown through repeated same-position reordering. Fix: widen
   *     the anchor's `path` column explicitly —
   *     `CAST(r.order_key AS CHAR(4096) CHARACTER SET ascii) COLLATE
   *     ascii_bin` — doing both jobs the pg cast did: width (4096 bytes,
   *     generous headroom over the reachable-depth threshold above) *and*
   *     collation (`CHARACTER SET ascii` alone resolves to
   *     `ascii_general_ci`, not `ascii_bin` — confirmed live that a bare
   *     `CAST(… AS CHAR(4096))` with no `CHARACTER SET`/`COLLATE` at all
   *     reverts to the *connection's* default collation, not the source
   *     column's, so both clauses are required, not just one).
   */
  async getTreeSubtree({
    collectionId,
    rootDocumentId = null,
    maxDepth = 10_000,
    readMode = 'any',
    locale = this.defaultContentLocale,
    filters,
  }: {
    collectionId: string
    rootDocumentId?: string | null
    maxDepth?: number
    readMode?: ReadMode
    locale?: string
    filters?: DocumentFilter[]
  }): Promise<
    Array<{
      document_id: string
      parent_document_id: string | null
      depth: number
      order_key: string
    }>
  > {
    const rootCondition =
      rootDocumentId == null
        ? sql`r.parent_document_id IS NULL`
        : sql`r.child_document_id = ${rootDocumentId}`
    const anchorGate = this.buildTreeVisibility(
      sql`r.child_document_id`,
      filters,
      locale,
      readMode,
      'sv0'
    )
    const childGate = this.buildTreeVisibility(
      sql`r.child_document_id`,
      filters,
      locale,
      readMode,
      'sv1'
    )

    const query = sql`
      WITH RECURSIVE subtree AS (
        SELECT r.child_document_id, r.parent_document_id, r.order_key,
               0 AS depth,
               CAST(r.order_key AS CHAR(4096) CHARACTER SET ascii) COLLATE ascii_bin AS path
        FROM byline_document_relationships r
        JOIN byline_documents d ON d.id = r.child_document_id
        WHERE d.collection_id = ${collectionId}
          AND ${rootCondition}
          AND ${anchorGate}
        UNION ALL
        SELECT r.child_document_id, r.parent_document_id, r.order_key,
               s.depth + 1, CONCAT(s.path, '/', r.order_key)
        FROM byline_document_relationships r
        JOIN subtree s ON r.parent_document_id = s.child_document_id
        WHERE s.depth + 1 <= ${maxDepth}
          AND ${childGate}
      )
      SELECT child_document_id AS document_id,
             CASE WHEN depth = 0 THEN NULL ELSE parent_document_id END AS parent_document_id,
             depth, order_key
      FROM subtree
      ORDER BY path
    `
    const result = (await this.db.execute(query)) as unknown as [
      Array<{
        document_id: string
        parent_document_id: string | null
        depth: number
        order_key: string
      }>,
      unknown,
    ]
    return result[0].map((r) => ({
      document_id: r.document_id as string,
      parent_document_id: (r.parent_document_id as string | null) ?? null,
      depth: Number(r.depth),
      order_key: r.order_key as string,
    }))
  }

  /**
   * getDocumentCountsByStatus
   *
   * Returns a count of current documents grouped by workflow status for a
   * given collection. Uses the `current_documents` view so each logical
   * document is counted once (at its latest/current version).
   */
  async getDocumentCountsByStatus({
    collection_id,
    filters,
  }: {
    collection_id: string
    filters?: DocumentFilter[]
  }): Promise<Array<{ status: string; count: number }>> {
    const conditions: SQL[] = [eq(currentDocumentsView.collection_id, collection_id)]
    if (filters?.length) {
      const outerScope: OuterScope = {
        docVersionId: sql`${currentDocumentsView.id}`,
        documentId: sql`${currentDocumentsView.document_id}`,
        status: sql`${currentDocumentsView.status}`,
        path: this.pathProjection(
          sql`${currentDocumentsView.document_id}`,
          this.defaultContentLocale
        ),
      }
      for (const f of filters) {
        conditions.push(
          this.buildFilterExists(f, this.defaultContentLocale, outerScope, undefined, 0)
        )
      }
    }
    const rows = await this.db
      .select({
        status: currentDocumentsView.status,
        count: sql<number>`CAST(COUNT(*) AS SIGNED)`,
      })
      .from(currentDocumentsView)
      .where(and(...conditions))
      .groupBy(currentDocumentsView.status)

    return rows.map((r) => ({
      status: r.status ?? 'unknown',
      count: Number(r.count),
    }))
  }

  /**
   * reconstructDocuments — retrieve field values and reconstruct multiple documents.
   * Supports selective field loading via the `fields` parameter. Pure
   * JS/core-delegate orchestration — ports unchanged from pg (the
   * dialect-specific work is one level down, in
   * `getAllFieldValuesForMultipleVersions`).
   */
  private async reconstructDocuments({
    documents: docs,
    locale = 'all',
    fields: requestedFields,
    onMissingLocale,
  }: {
    documents: Document[]
    locale?: string
    fields?: string[]
    onMissingLocale?: MissingLocalePolicy
  }): Promise<any[]> {
    if (docs.length === 0) return []
    const versionIds = docs.map((v) => v.id)

    // Resolve definition once for the batch (safe — early return above guarantees length > 0)
    const firstDoc = docs[0]!
    const definition = await this.getDefinitionForCollection(firstDoc.collection_id)

    // When specific fields are requested, resolve which store tables we need
    // and query only those — skipping irrelevant tables entirely.
    const storeTypes = requestedFields?.length
      ? resolveStoreTypes(definition.fields, requestedFields)
      : undefined

    // The distinct fallback floors for the batch — each document's own
    // `source_locale` anchor — so the field fetch pulls every locale a row in
    // this page might fall back to, not just the global default.
    const floorLocales = [
      ...new Set(docs.map((d) => d.source_locale).filter((l): l is string => l != null)),
    ]

    // Get field values for all versions in one query
    const allFieldValues = await this.getAllFieldValuesForMultipleVersions(
      versionIds,
      locale,
      storeTypes,
      floorLocales
    )

    // Group field values by document version
    const fieldValuesByVersion = new Map<string, UnifiedFieldValue[]>()
    for (const fieldValue of allFieldValues) {
      if (!fieldValuesByVersion.has(fieldValue.document_version_id)) {
        fieldValuesByVersion.set(fieldValue.document_version_id, [])
      }
      fieldValuesByVersion.get(fieldValue.document_version_id)?.push(fieldValue)
    }

    // Fetch meta rows for all versions in one query
    const allMetaRows = await this.db
      .select({
        document_version_id: metaStore.document_version_id,
        type: metaStore.type,
        path: metaStore.path,
        item_id: metaStore.item_id,
        meta: metaStore.meta,
      })
      .from(metaStore)
      .where(inArray(metaStore.document_version_id, versionIds))

    const metaByVersion = new Map<string, MetaRow[]>()
    for (const row of allMetaRows) {
      const list = metaByVersion.get(row.document_version_id) ?? []
      list.push({
        type: row.type,
        path: row.path,
        item_id: row.item_id,
        meta: row.meta as Record<string, any> | null,
      })
      if (!metaByVersion.has(row.document_version_id)) {
        metaByVersion.set(row.document_version_id, list)
      }
    }

    // Reconstruct each document with document data at root level
    const result: any[] = []
    for (const doc of docs) {
      const versionFieldValues = fieldValuesByVersion.get(doc.id) || []
      const docMetaRows = (metaByVersion.get(doc.id) ?? []) as MetaRow[]
      const { fields } = this.reconstructFromUnifiedRows(
        versionFieldValues,
        definition,
        locale,
        docMetaRows,
        false,
        onMissingLocale,
        doc.source_locale
      )

      // When specific fields were requested, trim the reconstructed object
      // to only those fields. Store-level filtering avoids querying unused
      // tables, but fields sharing a store (e.g. price + views in numeric)
      // still appear — this final pass removes them.
      const trimmedFields = requestedFields?.length
        ? Object.fromEntries(Object.entries(fields).filter(([k]) => requestedFields.includes(k)))
        : fields

      const documentWithFields = {
        document_version_id: doc.id,
        document_id: doc.document_id,
        path: doc.path ?? '',
        source_locale: doc.source_locale ?? null,
        status: doc.status,
        event_type: doc.event_type,
        created_at: doc.created_at,
        updated_at: doc.updated_at,
        created_by: doc.created_by ?? null,
        fields: trimmedFields,
      }

      result.push(documentWithFields)
    }

    return result
  }

  /**
   * Gets all field values for a single document version.
   * Delegates to the multi-version dynamic UNION ALL builder.
   */
  private async getAllFieldValues(
    documentVersionId: string,
    locale = 'all',
    sourceLocale?: string | null
  ): Promise<UnifiedFieldValue[]> {
    return this.getAllFieldValuesForMultipleVersions(
      [documentVersionId],
      locale,
      undefined,
      sourceLocale ? [sourceLocale] : undefined
    )
  }

  /**
   * Gets field values for multiple versions in a single query — the UNION
   * ALL that is the whole point of this task.
   *
   * When `storeTypes` is provided, only those store tables are included in
   * the UNION ALL — this is the selective field loading optimisation for
   * list views that only need a subset of fields.
   *
   * Locale-chain conversion (design spec §2, the store-row locale
   * condition): pg's `locale = ANY(ARRAY[...]) ` → MySQL `locale IN (...)`.
   * No `ORDER BY`/`FIELD()` needed here — this is a membership filter, not a
   * priority pick (unlike `pathProjection`, every matching locale row is
   * kept; `resolveEffectiveLocale`/`restoreFieldSetData` pick the effective
   * one in JS afterwards).
   *
   * `db.execute()` on the mysql2 driver returns a `[rows, fields]` tuple
   * (unlike pg's `{ rows }` result object) — see `storage-commands.ts` for
   * the established pattern this mirrors.
   */
  private async getAllFieldValuesForMultipleVersions(
    documentVersionIds: string[],
    locale = 'all',
    storeTypes?: Set<StoreType>,
    floorLocales?: string[]
  ): Promise<UnifiedFieldValue[]> {
    if (documentVersionIds.length === 0) return []

    let localeCondition = sql``
    if (locale !== 'all') {
      const floors = floorLocales?.length ? floorLocales : [this.defaultContentLocale]
      const chain = [...new Set([locale, ...floors])]
      const chainSql = sql.join(
        chain.map((l) => sql`${l}`),
        sql`, `
      )
      localeCondition = sql`AND (locale IN (${chainSql}) OR locale = 'all')`
    }

    const documentCondition = sql`document_version_id IN (${sql.join(
      documentVersionIds.map((id) => sql`${id}`),
      sql`, `
    )})`

    const typesToQuery = storeTypes ?? new Set(allStoreTypes)

    const fragments: SQL[] = []
    for (const st of allStoreTypes) {
      if (!typesToQuery.has(st)) continue
      fragments.push(
        sql`SELECT ${storeSelectList(st)} FROM ${sql.raw(storeTableNames[st])} WHERE ${documentCondition} ${localeCondition}`
      )
    }

    if (fragments.length === 0) return []

    let unionQuery = fragments[0]!
    for (let i = 1; i < fragments.length; i++) {
      unionQuery = sql`${unionQuery} UNION ALL ${fragments[i]}`
    }

    const query = sql`${unionQuery} ORDER BY document_version_id, field_path, locale`

    const result = (await this.db.execute(query)) as unknown as [
      Array<Record<string, unknown>>,
      unknown,
    ]
    // Canonicalise the raw UNION ALL driver rows at the ingestion boundary —
    // see normalizeRow's docstring for what the mysql2 driver leaves in a
    // shape core's reconstruction can't consume as-is (TINYINT(1)-as-number,
    // DECIMAL-as-string with decimalNumbers: false, and — the opposite of
    // what an earlier version of this comment claimed — DATETIME/DATE-as-
    // string, coerced to Date by normalizeRow, not already a Date).
    return result[0].map(normalizeRow)
  }

  /**
   * findDocuments — field-level filtered, sorted, paginated query.
   *
   * Each `FieldFilter` becomes an EXISTS subquery against the appropriate EAV
   * store table. A `RelationFilter` becomes a nested EXISTS that joins
   * `store_relation` to the target collection's current-documents view
   * (selected by `readMode` so draft leaks can't happen through filter
   * predicates) and recurses into its own `nested` filters. A `FieldSort`
   * becomes a LEFT JOIN LATERAL to pull the sort value into the outer query
   * — unchanged syntax from pg (the 8.0.14 engine floor guarantees LATERAL
   * support), confirmed live against this container. Document-level
   * conditions (status, path) are applied directly on the current_documents
   * view.
   */
  async findDocuments({
    collection_id,
    filters = [],
    status,
    pathFilter,
    query,
    sort,
    orderBy = 'created_at',
    orderDirection = 'desc',
    locale = 'en',
    page = 1,
    pageSize = 20,
    fields: requestedFields,
    readMode,
    onMissingLocale,
  }: {
    collection_id: string
    filters?: DocumentFilter[]
    status?: string
    pathFilter?: { operator: FieldFilterOperator; value: string }
    query?: string
    sort?: FieldSort
    orderBy?: string
    orderDirection?: 'asc' | 'desc'
    locale?: string
    page?: number
    pageSize?: number
    fields?: string[]
    readMode?: ReadMode
    onMissingLocale?: MissingLocalePolicy
  }): Promise<{ documents: any[]; total: number }> {
    const offset = (page - 1) * pageSize
    const sourceTable =
      readMode === 'published'
        ? sql.raw('byline_current_published_documents')
        : sql.raw('byline_current_documents')

    // -- Build WHERE conditions -----------------------------------------------
    const conditions: SQL[] = [sql`d.collection_id = ${collection_id}`]

    if (status) {
      conditions.push(sql`d.status = ${status}`)
    }

    // `onMissingLocale: 'omit'` — exclude documents not available in the
    // requested locale (filtered at the SQL layer so pagination stays correct).
    const strictGate = this.localeAvailabilityExists(sql`d.id`, locale, onMissingLocale)
    if (strictGate) {
      conditions.push(strictGate)
    }

    if (pathFilter) {
      conditions.push(
        this.buildFilterCondition(
          this.pathProjection(sql`d.document_id`, locale, sql`d.source_locale`),
          pathFilter.operator,
          pathFilter.value
        )
      )
    }

    // Admin list-view quick search via EXISTS on store_text. MySQL has no
    // `ILIKE` — the elected divergence (design spec §2, not "fixed"): plain
    // `LIKE` against `byline_store_text.value`, which keeps the schema's
    // database-default `utf8mb4_0900_ai_ci` collation, so this search is
    // already case- AND accent-insensitive (pg's `ILIKE` is case-insensitive
    // only). See `buildFilterCondition`'s `$contains` branch for the same
    // divergence on the field-filter path.
    if (query) {
      const definition = await this.getDefinitionForCollection(collection_id)
      const searchFields =
        definition.listSearch != null && definition.listSearch.length > 0
          ? definition.listSearch
          : [resolveIdentityField(definition) ?? 'title']
      const searchConditions = searchFields.map(
        (fieldName) => sql`(field_name = ${fieldName} AND value LIKE ${`%${query}%`})`
      )
      conditions.push(sql`EXISTS (
        SELECT 1 FROM byline_store_text
        WHERE document_version_id = d.id
          AND (locale = ${locale} OR locale = 'all')
          AND (${sql.join(searchConditions, sql` OR `)})
      )`)
    }

    // Field-level / relation-level EXISTS subqueries. Each relation hop
    // introduces its own alias scope (`r${depth}`, `td${depth}`) so nested
    // EXISTS clauses don't shadow their outer relation's aliases.
    for (const filter of filters) {
      conditions.push(
        this.buildFilterExists(
          filter,
          locale,
          {
            docVersionId: sql`d.id`,
            documentId: sql`d.document_id`,
            status: sql`d.status`,
            path: this.pathProjection(sql`d.document_id`, locale, sql`d.source_locale`),
          },
          readMode,
          0
        )
      )
    }

    const whereClause = sql.join(conditions, sql` AND `)

    // -- Build ORDER BY -------------------------------------------------------
    let orderClause: SQL
    let sortJoin: SQL = sql``

    if (sort) {
      // Field-level sort via LEFT JOIN LATERAL
      const storeTable = storeTableNames[sort.storeType as StoreType]
      if (storeTable) {
        sortJoin = sql`LEFT JOIN LATERAL (
          SELECT ${sql.raw(sort.valueColumn)} AS _sort_value
          FROM ${sql.raw(storeTable)}
          WHERE document_version_id = d.id
            AND field_name = ${sort.fieldName}
            AND (locale = ${locale} OR locale = 'all')
          LIMIT 1
        ) _sort ON true`
        // MySQL has no `NULLS LAST`. `DESC` already sorts NULL last by
        // default (confirmed live), so `_sort_value DESC` needs no help;
        // `ASC` sorts NULL first by default (the opposite of pg's `NULLS
        // LAST`), so the `(col IS NULL) ASC, col ASC` emulation idiom is
        // required — same idiom as `buildDocumentOrderClause`.
        orderClause =
          sort.direction === 'desc'
            ? sql`_sort._sort_value DESC`
            : sql`(_sort._sort_value IS NULL) ASC, _sort._sort_value ASC`
      } else {
        // Unrecognised store type — fall back to document-level sort
        orderClause = this.buildDocumentOrderClause(orderBy, orderDirection)
      }
    } else {
      orderClause = this.buildDocumentOrderClause(orderBy, orderDirection)
    }

    // -- Count query ----------------------------------------------------------
    // `count(*)::int` → `CAST(COUNT(*) AS SIGNED)` (design spec §2).
    const countQuery = sql`
      SELECT CAST(COUNT(*) AS SIGNED) AS total
      FROM ${sourceTable} d
      ${sortJoin}
      WHERE ${whereClause}
    `
    const countResult = (await this.db.execute(countQuery)) as unknown as [
      Array<{ total: number }>,
      unknown,
    ]
    const total = Number(countResult[0][0]?.total) || 0

    if (total === 0) {
      return { documents: [], total: 0 }
    }

    // -- Main query -----------------------------------------------------------
    //
    // `d.*` no longer includes `path` (it lives in byline_document_paths
    // keyed by document_id + locale). Project it via the locale-aware
    // subquery so the result rows still carry `path` for the in-memory
    // Document shape.
    const pathProjectionSql = this.pathProjection(sql`d.document_id`, locale, sql`d.source_locale`)
    const mainQuery = sql`
      SELECT d.*, ${pathProjectionSql} AS path
      FROM ${sourceTable} d
      ${sortJoin}
      WHERE ${whereClause}
      ORDER BY ${orderClause}
      LIMIT ${pageSize}
      OFFSET ${offset}
    `
    const mainResult = (await this.db.execute(mainQuery)) as unknown as [
      Array<Record<string, unknown>>,
      unknown,
    ]

    const currentDocuments: Document[] = mainResult[0].map((row) => ({
      id: row.id as string,
      document_id: row.document_id as string,
      collection_id: row.collection_id as string,
      collection_version: row.collection_version as number,
      path: (row.path as string | null) ?? null,
      event_type: row.event_type as string,
      status: row.status as string,
      // Raw driver row (not the schema-typed query builder) — TINYINT(1)
      // arrives as a JS number here, same as normalizeRow's boolean_value
      // columns. `current_documents`'s own CTE already filters
      // `is_deleted = false`, so this is always falsy in practice; coerced
      // properly regardless.
      is_deleted: Boolean(row.is_deleted),
      // Raw driver row on this `db.execute(sql\`...\`)` path — drizzle's
      // mysql2 driver hands DATETIME columns back as strings here, not
      // `Date` (see `toDate`'s docstring, `storage-utils.ts`), confirmed
      // live: an un-coerced `as Date` cast was lying at the type level.
      created_at: toDate(row.created_at as string, 'created_at') as Date,
      updated_at: toDate(row.updated_at as string, 'updated_at') as Date,
      created_by: row.created_by as string,
      change_summary: row.change_summary as string,
      source_locale: (row.source_locale as string | null) ?? null,
    }))

    const documents = await this.reconstructDocuments({
      documents: currentDocuments,
      locale,
      fields: requestedFields,
      onMissingLocale,
    })

    // Attach the version-locale availability metadata per row (one batched
    // indexed query for the whole page) so list consumers can render
    // language affordances / hreflang without a follow-up fetch.
    const availability = await this.getAvailableLocalesByVersion(
      documents.map((d) => d.document_version_id)
    )
    const advertised = await this.getAdvertisedLocalesByDocument(
      documents.map((d) => d.document_id)
    )
    for (const doc of documents) {
      const a = availability.get(doc.document_version_id)
      doc.availableLocales = advertised.get(doc.document_id) ?? []
      doc._availableVersionLocales = a?.availableLocales ?? []
      doc._localeAgnostic = a?.localeAgnostic ?? false
    }

    return { documents, total }
  }

  /**
   * Compile status and `beforeRead` visibility for one tree edge endpoint.
   * Ports unchanged from pg — the `EXISTS` shape has no dialect-specific
   * SQL of its own (its nested `buildFilterExists` calls carry the
   * dialect-specific bits).
   */
  private buildTreeVisibility(
    documentId: SQL,
    filters: DocumentFilter[] | undefined,
    locale: string,
    readMode: ReadMode,
    aliasName: string
  ): SQL {
    const view =
      readMode === 'published'
        ? sql.raw('byline_current_published_documents')
        : sql.raw('byline_current_documents')
    const alias = sql.raw(aliasName)
    const scope: OuterScope = {
      docVersionId: sql`${alias}.id`,
      documentId: sql`${alias}.document_id`,
      status: sql`${alias}.status`,
      path: this.pathProjection(sql`${alias}.document_id`, locale, sql`${alias}.source_locale`),
    }
    const filterSql = (filters ?? []).map((filter) =>
      this.buildFilterExists(filter, locale, scope, readMode, 0)
    )
    const filterClause = filterSql.length > 0 ? sql` AND ${sql.join(filterSql, sql` AND `)}` : sql``
    return sql`EXISTS (
      SELECT 1 FROM ${view} ${alias}
      WHERE ${alias}.document_id = ${documentId}${filterClause}
    )`
  }

  /**
   * Build an EXISTS subquery for a single DocumentFilter. Dispatches on
   * `kind` — field filters emit a direct EXISTS against the field's EAV
   * store; relation filters emit a nested EXISTS that joins through
   * `store_relation` to the target collection's current-documents view
   * and recurses against the target's own stores; combinator filters
   * emit a parenthesised AND/OR group; document-column filters emit a
   * direct comparison on the outer scope's status/path column. Ports
   * unchanged from pg — the dispatch itself has no dialect-specific SQL.
   */
  private buildFilterExists(
    filter: DocumentFilter,
    locale: string,
    outerScope: OuterScope,
    readMode: ReadMode | undefined,
    depth: number
  ): SQL {
    switch (filter.kind) {
      case 'field':
        return this.buildFieldExists(filter, locale, outerScope.docVersionId)
      case 'relation':
        return this.buildRelationExists(filter, locale, outerScope, readMode, depth)
      case 'and':
      case 'or':
        return this.buildCombinatorGroup(filter, locale, outerScope, readMode, depth)
      case 'docColumn':
        return this.buildDocColumnFilter(filter, outerScope)
    }
  }

  /**
   * Build a parenthesised AND/OR group from a CombinatorFilter. Each child
   * compiles through `buildFilterExists` recursively, so combinators nest
   * freely and inherit the outer scope. Ports unchanged from pg.
   */
  private buildCombinatorGroup(
    filter: CombinatorFilter,
    locale: string,
    outerScope: OuterScope,
    readMode: ReadMode | undefined,
    depth: number
  ): SQL {
    const childSql = filter.children.map((child) =>
      this.buildFilterExists(child, locale, outerScope, readMode, depth)
    )
    const joiner = filter.kind === 'or' ? sql` OR ` : sql` AND `
    return sql`(${sql.join(childSql, joiner)})`
  }

  /**
   * Compile a `DocumentColumnFilter` against the outer scope's `status`,
   * `path`, or `id` column. Plain comparison — no EXISTS — because the
   * column lives directly on the outer relation (current-documents view),
   * not in the EAV stores. Ports unchanged from pg.
   */
  private buildDocColumnFilter(filter: DocumentColumnFilter, outerScope: OuterScope): SQL {
    const column =
      filter.column === 'status'
        ? outerScope.status
        : filter.column === 'path'
          ? outerScope.path
          : outerScope.documentId
    return this.buildFilterCondition(column, filter.operator, filter.value)
  }

  /**
   * Build an EXISTS subquery for a single field-level filter. Ports
   * unchanged from pg (aside from `buildFilterCondition`'s `ILIKE` → `LIKE`
   * one level down).
   */
  private buildFieldExists(filter: FieldFilter, locale: string, outerDocVersionId: SQL): SQL {
    const storeTable = storeTableNames[filter.storeType as StoreType]
    if (!storeTable) {
      throw ERR_DATABASE({
        message: `unknown store type: ${filter.storeType}`,
        details: { storeType: filter.storeType },
      }).log(getLogger())
    }

    const valueCol = sql.raw(filter.valueColumn)
    const condition = this.buildFilterCondition(valueCol, filter.operator, filter.value)

    return sql`EXISTS (
      SELECT 1 FROM ${sql.raw(storeTable)}
      WHERE document_version_id = ${outerDocVersionId}
        AND field_name = ${filter.fieldName}
        AND (locale = ${locale} OR locale = 'all')
        AND ${condition}
    )`
  }

  /**
   * Build a nested EXISTS subquery for a cross-collection relation filter.
   *
   * Joins `store_relation` to the target collection's current-documents
   * view (`current_published_documents` under `readMode: 'published'`,
   * `current_documents` otherwise — so a draft target doesn't leak when
   * the outer read is in published mode), then recurses each nested
   * filter against the target version's own `td.id`.
   *
   * `hasMany` relations store one row per item at an indexed field name
   * (`<field>.0`, `<field>.1`, …), so the field match switches to a prefix
   * match; single relations match the exact name.
   *
   * The `quantifier` selects the set semantics over the relation's
   * (resolving) targets — see pg's docblock for the full 'some'/'none'/
   * 'every' semantics; this method ports the SQL shape unchanged.
   */
  private buildRelationExists(
    filter: RelationFilter,
    locale: string,
    outerScope: OuterScope,
    readMode: ReadMode | undefined,
    depth: number
  ): SQL {
    const targetView =
      readMode === 'published'
        ? sql.raw('byline_current_published_documents')
        : sql.raw('byline_current_documents')

    // Use depth-scoped aliases so nested relations don't shadow their
    // outer scope. e.g. outer relation gets `r0`/`td0`; a relation filter
    // nested inside that gets `r1`/`td1`.
    const rAlias = sql.raw(`r${depth}`)
    const tdAlias = sql.raw(`td${depth}`)
    const innerScope: OuterScope = {
      docVersionId: sql.raw(`td${depth}.id`),
      documentId: sql.raw(`td${depth}.document_id`),
      status: sql.raw(`td${depth}.status`),
      // `td${depth}.path` no longer exists on the view; resolve via the
      // locale priority chain against byline_document_paths instead, anchored
      // to the target document's own `source_locale`.
      path: this.pathProjection(
        sql.raw(`td${depth}.document_id`),
        locale,
        sql.raw(`td${depth}.source_locale`)
      ),
    }

    const nestedConditions: SQL[] = filter.nested.map((nested) =>
      this.buildFilterExists(nested, locale, innerScope, readMode, depth + 1)
    )

    const quantifier = filter.quantifier ?? 'some'

    // `every` with nothing to fail is vacuously true for every document —
    // short-circuit rather than emitting `NOT (TRUE)` noise.
    if (quantifier === 'every' && nestedConditions.length === 0) {
      return sql`TRUE`
    }

    // 'some'/'none' assert the nested conjunction on a matching row;
    // 'every' asserts the *negated* conjunction (a failing row) and wraps
    // the whole scan in NOT.
    const nestedAnd =
      nestedConditions.length === 0
        ? sql``
        : quantifier === 'every'
          ? sql` AND NOT (${sql.join(nestedConditions, sql` AND `)})`
          : sql` AND ${sql.join(nestedConditions, sql` AND `)}`

    // hasMany rows are stored at indexed paths (`gallery.0`, `gallery.1`, …)
    // where `field_name` is the *index segment* ('0', '1', …) and
    // `parent_path` is the field name — so multi-target rows match on
    // `parent_path` exactly, single-target rows on `field_name`. (A where
    // clause only addresses top-level fields, so `parent_path` needs no
    // prefix handling.)
    const fieldMatch = filter.hasMany
      ? sql`${rAlias}.parent_path = ${filter.fieldName}`
      : sql`${rAlias}.field_name = ${filter.fieldName}`

    const existsSql = sql`EXISTS (
      SELECT 1 FROM byline_store_relation ${rAlias}
      JOIN ${targetView} ${tdAlias}
        ON ${tdAlias}.document_id = ${rAlias}.target_document_id
       AND ${tdAlias}.collection_id = ${rAlias}.target_collection_id
      WHERE ${rAlias}.document_version_id = ${outerScope.docVersionId}
        AND ${fieldMatch}
        AND ${rAlias}.target_collection_id = ${filter.targetCollectionId}
        AND (${rAlias}.locale = ${locale} OR ${rAlias}.locale = 'all')${nestedAnd}
    )`

    return quantifier === 'some' ? existsSql : sql`NOT ${existsSql}`
  }

  /**
   * Build a comparison condition for a filter operator.
   *
   * `$contains` divergence (design spec §2, elected — not "fixed"): pg's
   * `ILIKE` has no MySQL equivalent, so this compiles to plain `LIKE`. The
   * store `value` columns keep the schema's default `utf8mb4_0900_ai_ci`
   * collation, which is case- *and* accent-insensitive — a strictly wider
   * match than pg's case-insensitive-only `ILIKE`. `byline_document_paths
   * .path` is the one column this operator also reaches (via
   * `buildDocColumnFilter`'s `path` branch) that is NOT `ai_ci` — it's
   * `utf8mb4_bin` (`varcharCaseSensitive`, `database/schema/common.ts`), so
   * a `$contains` against `path` stays byte-exact and matches pg exactly.
   * Both behaviours fall out of the column's own collation; nothing here
   * special-cases `path` vs a store value.
   */
  private buildFilterCondition(
    column: SQL,
    operator: string,
    value: string | number | boolean | null | Array<string | number>
  ): SQL {
    switch (operator) {
      case '$eq':
        return value === null ? sql`${column} IS NULL` : sql`${column} = ${value}`
      case '$ne':
        return value === null ? sql`${column} IS NOT NULL` : sql`${column} != ${value}`
      case '$gt':
        return sql`${column} > ${value}`
      case '$gte':
        return sql`${column} >= ${value}`
      case '$lt':
        return sql`${column} < ${value}`
      case '$lte':
        return sql`${column} <= ${value}`
      case '$contains':
        return sql`${column} LIKE ${`%${String(value)}%`}`
      case '$in': {
        const arr = value as Array<string | number>
        // Empty `$in` matches nothing — explicit FALSE avoids generating
        // an invalid empty `IN ()` clause.
        if (arr.length === 0) return sql`FALSE`
        const items = sql.join(
          arr.map((v) => sql`${v}`),
          sql`, `
        )
        return sql`${column} IN (${items})`
      }
      case '$nin': {
        const arr = value as Array<string | number>
        if (arr.length === 0) return sql`TRUE`
        const items = sql.join(
          arr.map((v) => sql`${v}`),
          sql`, `
        )
        return sql`${column} NOT IN (${items})`
      }
      default:
        throw ERR_DATABASE({
          message: `unsupported filter operator: ${operator}`,
          details: { operator },
        }).log(getLogger())
    }
  }

  /**
   * Build an ORDER BY clause for a document-level column. `path` is
   * intentionally not sortable here — see pg's docblock.
   *
   * Divergence from pg (found by reasoning, confirmed live against this
   * container): MySQL has no `NULLS LAST`. For `DESC`, MySQL already sorts
   * NULL last by default, so `d.order_key DESC` needs no help. For `ASC`,
   * MySQL's default sorts NULL *first* — the opposite of pg's `NULLS LAST`
   * — so the emulation idiom `ORDER BY (col IS NULL), col ASC` is required
   * to match pg's behaviour (`(col IS NULL)` evaluates 0/1; ascending puts
   * real values, which evaluate to 0, before NULLs, which evaluate to 1).
   */
  private buildDocumentOrderClause(orderBy: string, direction: 'asc' | 'desc'): SQL {
    if (orderBy === 'order_key') {
      return direction === 'desc'
        ? sql`d.order_key DESC, d.created_at DESC`
        : sql`(d.order_key IS NULL) ASC, d.order_key ASC, d.created_at DESC`
    }
    const columnMap: Record<string, string> = {
      created_at: 'd.created_at',
      updated_at: 'd.updated_at',
    }
    const col = columnMap[orderBy] ?? 'd.created_at'
    return direction === 'desc' ? sql`${sql.raw(col)} DESC` : sql`${sql.raw(col)} ASC`
  }

  /**
   * Converts a union field row back into an array of FlattenedStore that
   * the reconstruction utilities expect. Pure JS mapping — ports unchanged
   * from pg.
   */
  private convertUnionRowToFlattenedStores(unionRowValues: UnifiedFieldValue[]): FlattenedStore[] {
    return unionRowValues.map((row) => {
      const baseValue = {
        field_path: row.field_path,
        field_name: row.field_name,
        locale: row.locale,
        parent_path: row.parent_path ?? undefined,
      }

      switch (row.field_type) {
        case 'text':
          return {
            ...baseValue,
            field_type: 'text' as const,
            value: row.text_value,
          }

        case 'richText':
          return {
            ...baseValue,
            field_type: 'richText' as const,
            value: row.json_value,
          }

        case 'numeric':
          return {
            ...baseValue,
            field_type: row.number_type as 'float' | 'integer' | 'decimal',
            number_type: row.number_type,
            value_integer: row.value_integer,
            value_decimal: row.value_decimal,
            value_float: row.value_float,
          }

        case 'boolean':
          return {
            ...baseValue,
            field_type: 'boolean' as const,
            value: row.boolean_value,
          }

        case 'time':
        case 'date':
        case 'datetime':
          return {
            ...baseValue,
            field_type: row.date_type as 'time' | 'date' | 'datetime',
            date_type: row.date_type,
            value_time: row.value_time,
            value_date: row.value_date,
            value_timestamp_tz: row.value_timestamp_tz,
          }

        case 'image':
        case 'file':
          return {
            ...baseValue,
            field_type: row.field_type as 'image' | 'file',
            file_id: row.file_id,
            filename: row.filename,
            original_filename: row.original_filename,
            mime_type: row.mime_type,
            file_size: row.file_size,
            storage_provider: row.storage_provider,
            storage_path: row.storage_path,
            storage_url: row.storage_url,
            file_hash: row.file_hash,
            image_width: row.image_width,
            image_height: row.image_height,
            image_format: row.image_format,
            processing_status: row.processing_status,
            thumbnail_generated: row.thumbnail_generated,
          }

        case 'relation':
          return {
            ...baseValue,
            field_type: 'relation' as const,
            target_document_id: row.target_document_id,
            target_collection_id: row.target_collection_id,
            relationship_type: row.relationship_type,
            cascade_delete: row.cascade_delete,
          }

        default:
          throw ERR_DATABASE({
            message: `unknown field type: ${row.field_type}`,
            details: { fieldType: row.field_type },
          }).log(getLogger())
      }
    }) as FlattenedStore[]
  }
}

export function createQueryBuilders(
  db: DatabaseConnection,
  collections: readonly CollectionDefinition[],
  defaultContentLocale: string,
  transactionDb: DBManager
) {
  return {
    collections: new CollectionQueries(db),
    documents: new DocumentQueries(db, collections, defaultContentLocale, transactionDb),
  }
}
