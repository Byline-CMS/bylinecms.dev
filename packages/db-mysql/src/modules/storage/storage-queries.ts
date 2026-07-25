/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Task 10A — the MySQL storage read path. Ported from
 * `packages/db-postgres/src/modules/storage/storage-queries.ts`, scoped per
 * the Task 10A controller amendments: the UNION ALL reconstruction path
 * (`getDocumentById`, `getDocumentByVersion`, `getDocumentHistory`) and
 * `findDocuments` far enough to serve the `versioning` + `field-types`
 * `@byline/db-conformance` suites, including selective field loading
 * (`resolveStoreTypes`).
 *
 * Deliberately NOT ported here (Task 10B): the `filters` (`DocumentFilter[]`
 * — `$and`/`$or` combinators, relation hops, document-column filters)
 * predicate compiler, `findDocuments`' `pathFilter`/`query` (LIKE search)/
 * `sort` (`LEFT JOIN LATERAL` field sort), `getDocumentByPath`,
 * `getDocumentsByVersionIds`, `getDocumentsByDocumentIds`,
 * `getPublishedVersion`, `getPublishedDocumentIds`,
 * `getDocumentCountsByStatus`, order-key / tree reads, `getCurrentPath`, and
 * `getDocumentSystemFieldsForUpdate`. `DocumentQueries` therefore does NOT
 * declare `implements IDocumentQueries` — that compile-time check only
 * becomes meaningful once every member lands. `src/index.ts` wires each
 * implemented member individually, exactly as `storage-commands.ts` did
 * through Tasks 9A/9B.
 */

import type {
  CollectionDefinition,
  DocumentFilter,
  FieldFilterOperator,
  FieldSort,
  FlattenedFieldValue,
  FlattenedStore,
  ICollectionQueries,
  MissingLocalePolicy,
  ReadMode,
  UnifiedFieldValue,
} from '@byline/core'
import {
  ERR_DATABASE,
  ERR_NOT_FOUND,
  extractFlattenedFieldValue,
  getLogger,
  orderByContentLocale,
  resolveStoreTypes,
  restoreFieldSetData,
} from '@byline/core'
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm'
import type { MySql2Database } from 'drizzle-orm/mysql2'

import {
  collections,
  currentDocumentsView,
  currentPublishedDocumentsView,
  documentAvailableLocales,
  documentPaths,
  documentVersionLocales,
  documentVersions,
  metaStore,
} from '../../database/schema/index.js'
import type * as schema from '../../database/schema/index.js'
import type { DBManager } from '../../lib/db-manager.js'

type DatabaseConnection = MySql2Database<typeof schema>
// `path` was dropped from documentVersions in favour of byline_document_paths;
// SELECT projections re-attach it via a locale-aware subquery (see
// `pathProjection`), so the in-memory Document shape continues to carry it.
// `source_locale` (the per-document content-locale anchor) rides alongside so
// the locale-aware read paths re-base the fallback floor onto it rather than
// the mutable global default. See docs/07-internationalization/index.md.
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

interface MetaRow {
  type: string
  path: string
  item_id: string
  meta: Record<string, any> | null
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
 * DocumentQueries — Task 10A scope only. See the module docblock for what's
 * deliberately not ported yet.
 */
export class DocumentQueries {
  private db: DatabaseConnection
  // Not read by any Task 10A method (none of getDocumentById/ByVersion/
  // History/findDocuments needs a locked, ambient-transaction-aware read) —
  // kept for constructor-signature parity with pg's DocumentQueries and
  // because a locked read (getDocumentSystemFieldsForUpdate) is exactly the
  // kind of member Task 10B adds.
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: forward scaffolding for Task 10B, see comment above
  private transactionDb: DBManager
  private collections: readonly CollectionDefinition[]
  private defaultContentLocale: string
  private collectionPathCache = new Map<string, string>()

  constructor(
    db: DatabaseConnection,
    collections: readonly CollectionDefinition[],
    defaultContentLocale: string,
    transactionDb: DBManager = { get: () => db }
  ) {
    this.db = db
    this.transactionDb = transactionDb
    this.collections = collections
    this.defaultContentLocale = defaultContentLocale
  }

  /**
   * Guard for the four Task 10B-owned query features
   * (`filters`/`pathFilter`/`query`/`sort`). Fails loudly rather than
   * silently ignoring a `beforeRead`-hook predicate or a search/sort
   * request — a caller relying on row-scoping getting an unscoped result
   * back would be a silent security regression, not a missing feature.
   */
  private assertUnsupported(condition: boolean, method: string, feature: string): void {
    if (!condition) return
    throw ERR_DATABASE({
      message: `${method}: '${feature}' is not implemented on @byline/db-mysql yet (Task 10B)`,
      details: { method, feature },
    }).log(getLogger())
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
   * global default, which is correct for not-yet-anchored rows. See
   * docs/07-internationalization/index.md.
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
   * getDocumentById — gets the current version of a document by its logical document ID.
   *
   * When `lenient` is true, schema-mismatch warnings emitted during
   * reconstruction are surfaced on the returned object as `restoreWarnings`
   * rather than thrown. This is the admin edit path's "best-effort load"
   * mode for documents written under a previous collection schema.
   *
   * `filters` (the `beforeRead`-hook predicate) is accepted for interface
   * parity but not yet compiled — see `assertUnsupported`. Task 10B.
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
    this.assertUnsupported(!!filters?.length, 'getDocumentById', 'filters')

    const view = this.pickCurrentView(readMode)
    const baseConditions: SQL[] = [
      eq(view.collection_id, collection_id),
      eq(view.document_id, document_id),
    ]
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
   * getDocumentByVersion — fetches a specific version and reconstructs its fields.
   *
   * `filters` accepted for interface parity, not yet compiled. Task 10B.
   */
  async getDocumentByVersion({
    document_version_id,
    locale = 'all',
    collection_id,
    filters,
  }: {
    document_version_id: string
    locale?: string
    collection_id?: string
    filters?: DocumentFilter[]
  }): Promise<any | null> {
    this.assertUnsupported(!!filters?.length, 'getDocumentByVersion', 'filters')

    const projectionLocale = locale === 'all' ? undefined : locale
    const conditions: SQL[] = [eq(documentVersions.id, document_version_id)]
    if (collection_id) conditions.push(eq(documentVersions.collection_id, collection_id))

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
   * getDocumentHistory — paginated version history for a logical document.
   *
   * `filters` accepted for interface parity, not yet compiled. Task 10B.
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
    this.assertUnsupported(!!filters?.length, 'getDocumentHistory', 'filters')

    const collection = await this.db.query.collections.findFirst({
      where: eq(collections.id, collection_id),
    })

    if (collection == null || collection.config == null) {
      throw ERR_NOT_FOUND({
        message: `collection not found or missing config: ${collection_id}`,
        details: { collectionId: collection_id },
      }).log(getLogger())
    }

    const conditions: SQL[] = [
      eq(documentVersions.collection_id, collection_id),
      eq(documentVersions.document_id, document_id),
    ]

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
   * Reconstruct a batch of already-fetched `Document` rows into full
   * documents, applying selective field loading when `fields` is supplied.
   * Pure JS/core-delegate orchestration around `getAllFieldValuesForMultipleVersions`
   * — ports unchanged from pg (the dialect-specific work is one level down).
   */
  private async reconstructDocuments({
    documents,
    locale = 'all',
    fields: requestedFields,
    onMissingLocale,
  }: {
    documents: Document[]
    locale?: string
    fields?: string[]
    onMissingLocale?: MissingLocalePolicy
  }): Promise<any[]> {
    if (documents.length === 0) return []
    const versionIds = documents.map((v) => v.id)

    // Resolve definition once for the batch (safe — early return above guarantees length > 0)
    const firstDoc = documents[0]!
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
      ...new Set(documents.map((d) => d.source_locale).filter((l): l is string => l != null)),
    ]

    const allFieldValues = await this.getAllFieldValuesForMultipleVersions(
      versionIds,
      locale,
      storeTypes,
      floorLocales
    )

    const fieldValuesByVersion = new Map<string, UnifiedFieldValue[]>()
    for (const fieldValue of allFieldValues) {
      if (!fieldValuesByVersion.has(fieldValue.document_version_id)) {
        fieldValuesByVersion.set(fieldValue.document_version_id, [])
      }
      fieldValuesByVersion.get(fieldValue.document_version_id)?.push(fieldValue)
    }

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

    const result: any[] = []
    for (const doc of documents) {
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

      result.push({
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
      })
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
    // DECIMAL-as-string with decimalNumbers: false, DATETIME(3)-as-Date).
    return result[0].map(normalizeRow)
  }

  /**
   * findDocuments — Task 10A scope: `collection_id` + optional exact-match
   * `status` + `locale` + basic document-level pagination/ordering +
   * selective field loading (`fields`) + `readMode`/`onMissingLocale`. This
   * is enough to serve the `field-types` conformance suite's two calls
   * (with and without `fields`).
   *
   * Deliberately NOT implemented (Task 10B, per the controller amendments):
   * `filters` (`DocumentFilter[]` — `$and`/`$or` combinators, relation-hop
   * EXISTS, document-column filters), `pathFilter`, `query` (admin
   * quick-search LIKE), `sort` (field-level `LEFT JOIN LATERAL` sort). Any
   * of these being passed throws rather than silently ignoring the request
   * — a caller expecting row-scoping or a specific sort order getting an
   * unscoped/default-ordered result back would be a silent correctness bug.
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
    this.assertUnsupported(filters.length > 0, 'findDocuments', 'filters')
    this.assertUnsupported(!!pathFilter, 'findDocuments', 'pathFilter')
    this.assertUnsupported(!!query, 'findDocuments', 'query')
    this.assertUnsupported(!!sort, 'findDocuments', 'sort')

    const offset = (page - 1) * pageSize
    const sourceTable =
      readMode === 'published'
        ? sql.raw('byline_current_published_documents')
        : sql.raw('byline_current_documents')

    const conditions: SQL[] = [sql`d.collection_id = ${collection_id}`]

    if (status) {
      conditions.push(sql`d.status = ${status}`)
    }

    const strictGate = this.localeAvailabilityExists(sql`d.id`, locale, onMissingLocale)
    if (strictGate) {
      conditions.push(strictGate)
    }

    const whereClause = sql.join(conditions, sql` AND `)
    const orderClause = this.buildDocumentOrderClause(orderBy, orderDirection)

    // `count(*)::int` → `CAST(COUNT(*) AS SIGNED)` (design spec §2).
    const countQuery = sql`
      SELECT CAST(COUNT(*) AS SIGNED) AS total
      FROM ${sourceTable} d
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

    const pathProjectionSql = this.pathProjection(sql`d.document_id`, locale, sql`d.source_locale`)
    const mainQuery = sql`
      SELECT d.*, ${pathProjectionSql} AS path
      FROM ${sourceTable} d
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
      created_at: row.created_at as Date,
      updated_at: row.updated_at as Date,
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
   * Build an ORDER BY clause for a document-level column. `path` is
   * intentionally not sortable here — see pg's docblock.
   *
   * Divergence from pg (found by reasoning, confirmed live — see the Task
   * 10A report): MySQL has no `NULLS LAST`. For `DESC`, MySQL already sorts
   * NULL last by default (confirmed against the live container), so
   * `d.order_key DESC` needs no help. For `ASC`, MySQL's default sorts NULL
   * *first* — the opposite of pg's `NULLS LAST` — so the emulation idiom
   * `ORDER BY (col IS NULL), col ASC` is required to match pg's behaviour
   * (`(col IS NULL)` evaluates 0/1; ascending puts real values, which
   * evaluate to 0, before NULLs, which evaluate to 1).
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

/** True when `a` contains every member of `b`. */
function isSuperset<T>(a: Set<T>, b: Set<T>): boolean {
  for (const item of b) {
    if (!a.has(item)) return false
  }
  return true
}

export function createQueryBuilders(
  db: DatabaseConnection,
  collections: readonly CollectionDefinition[],
  defaultContentLocale: string,
  transactionDb?: DBManager
) {
  return {
    collections: new CollectionQueries(db),
    documents: new DocumentQueries(db, collections, defaultContentLocale, transactionDb),
  }
}
