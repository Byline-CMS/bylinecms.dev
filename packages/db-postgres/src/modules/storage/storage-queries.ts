/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  CollectionDefinition,
  CombinatorFilter,
  DocumentColumnFilter,
  DocumentFilter,
  FieldFilter,
  FieldSort,
  FlattenedStore,
  ICollectionQueries,
  IDocumentQueries,
  MissingLocalePolicy,
  ReadMode,
  RelationFilter,
  UnionRowValue,
} from '@byline/core'
// TODO: getLogger() is used here as a global escape hatch because pgAdapter()
// constructs query/command classes before initBylineCore() wires up the Pino
// logger. A future refactor could inject the logger at construction time by
// either deferring adapter construction or accepting a lazy logger parameter.
import { ERR_DATABASE, ERR_NOT_FOUND, getLogger } from '@byline/core'
import { and, desc, eq, inArray, isNotNull, type SQL, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import {
  collections,
  currentDocumentsView,
  currentPublishedDocumentsView,
  documentAvailableLocales,
  documentPaths,
  documents,
  documentVersionLocales,
  documentVersions,
  metaStore,
} from '../../database/schema/index.js'
import type * as schema from '../../database/schema/index.js'

type DatabaseConnection = NodePgDatabase<typeof schema>
// `path` was dropped from documentVersions in favour of byline_document_paths;
// SELECT projections re-attach it via a locale-aware subquery (see
// `pathProjection`), so the in-memory Document shape continues to carry it.
// `source_locale` (the per-document content-locale anchor) rides alongside so
// the locale-aware read paths re-base the fallback floor onto it rather than
// the mutable global default. See docs/I18N.md.
type Document = Omit<typeof documentVersions.$inferSelect, 'doc'> & {
  path: string | null
  source_locale: string | null
}

import { extractFlattenedFieldValue, restoreFieldSetData } from './storage-restore.js'
import {
  allStoreTypes,
  type StoreType,
  storeSelectList,
  storeTableNames,
} from './storage-store-manifest.js'
import { resolveStoreTypes } from './storage-utils.js'
import type { FlattenedFieldValue, UnifiedFieldValue } from './@types.js'

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
 * matches what callers writing `where: { id }` expect.
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
  private db: DatabaseConnection
  private collections: CollectionDefinition[]
  private defaultContentLocale: string
  private collectionPathCache = new Map<string, string>()

  constructor(
    db: DatabaseConnection,
    collections: CollectionDefinition[],
    defaultContentLocale: string
  ) {
    this.db = db
    this.collections = collections
    this.defaultContentLocale = defaultContentLocale
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
   * row-less lookups (findByPath). See docs/I18N.md.
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
   * conditionally push it into a WHERE.
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
   * concrete locales its content is complete in (`availableLocales`, sorted),
   * or `localeAgnostic: true` when the version carries only the `'all'`
   * sentinel (no localized content → renders identically in every locale).
   * Drives the `_availableVersionLocales` read metadata. One indexed query per call.
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
    for (const entry of result.values()) entry.availableLocales.sort()
    return result
  }

  /**
   * Batch-fetch the editorial advertised-locale sets from
   * `byline_document_available_locales` (document-grain). For each logical
   * document returns the sorted set of locales the editor has elected to
   * advertise. Surfaced on reads as `availableLocales` — the deliberate
   * counterpart to the version-grain `_availableVersionLocales` ledger fact;
   * the public advertised set is their intersection. One indexed query per
   * call. See docs/I18N.md.
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
    for (const arr of result.values()) arr.sort()
    return result
  }

  /**
   * Emit a SQL fragment that resolves the path string for a document via
   * the locale priority chain. Used as a projected column expression
   * inside `SELECT` lists.
   *
   * ```sql
   * (SELECT path FROM byline_document_paths
   *  WHERE document_id = <docIdSql>
   *    AND locale = ANY(<chain>)
   *  ORDER BY array_position(<chain>, locale)
   *  LIMIT 1)
   * ```
   */
  private pathProjection(
    documentIdCol: SQL,
    requestedLocale?: string,
    sourceLocaleCol?: SQL
  ): SQL<string | null> {
    // The fallback floor: the row's `source_locale` column when supplied
    // (COALESCE-guarded for not-yet-anchored NULL rows), otherwise the
    // configured global default. The chain is `[requested, floor]`; a runtime
    // duplicate (requested === floor) is harmless — `array_position` picks the
    // first match and `LIMIT 1` collapses it.
    const floorSql: SQL = sourceLocaleCol
      ? sql`COALESCE(${sourceLocaleCol}, ${this.defaultContentLocale})`
      : sql`${this.defaultContentLocale}`
    const requestedSql: SQL = requestedLocale != null ? sql`${requestedLocale}` : floorSql
    // Build a `ARRAY[$1, $2]::text[]` literal so each locale is its own
    // parameter. Passing a JS array as a single `${chain}` placeholder
    // serialises as a scalar string (`'en'`), which Postgres rejects when
    // cast to `text[]` ("malformed array literal").
    const chainSql = sql.join([requestedSql, floorSql], sql`, `)
    return sql<string | null>`(
      SELECT ${documentPaths.path} FROM ${documentPaths}
      WHERE ${documentPaths.document_id} = ${documentIdCol}
        AND ${documentPaths.locale} = ANY(ARRAY[${chainSql}]::text[])
      ORDER BY array_position(ARRAY[${chainSql}]::text[], ${documentPaths.locale})
      LIMIT 1
    )`
  }

  /**
   * Project list for `current_documents` / `current_published_documents`
   * reads, with `path` resolved through the locale priority chain. Used
   * everywhere a read previously did `.select()` (which auto-pulls every
   * view column) — `path` is no longer projected by the views, so call
   * sites must list the projection explicitly. This helper keeps the
   * shape consistent and the call sites tidy.
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
    // `source_locale` lives on `byline_documents` (document-grain), not the
    // version row — resolve it via a correlated subquery so point-in-time
    // history reads re-base their fallback floor onto the document's anchor,
    // consistent with the current-documents views.
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
   * Emit a SQL fragment that resolves a `(collection_id, path)` tuple to
   * a `document_id` via the locale priority chain. Used inside `WHERE`
   * clauses for findByPath-style lookups:
   *
   * ```sql
   * WHERE document_id = (
   *   SELECT document_id FROM byline_document_paths
   *   WHERE collection_id = ? AND path = ?
   *     AND locale = ANY(<chain>)
   *   ORDER BY array_position(<chain>, locale)
   *   LIMIT 1
   * )
   * ```
   *
   * Returns NULL when no row matches in any locale, which makes the
   * outer `=` predicate fail cleanly (no document found).
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
        AND ${documentPaths.locale} = ANY(ARRAY[${chainSql}]::text[])
      ORDER BY array_position(ARRAY[${chainSql}]::text[], ${documentPaths.locale})
      LIMIT 1
    )`
  }

  /**
   * Resolve the single effective content locale a version should be restored
   * in, walking the fallback chain (`[requested, default]`) and returning the
   * first locale the version is *available* in.
   *
   * Phase-1 availability rule — **path-coverage against the default locale**:
   * the default (terminal) locale defines the canonical set of localized field
   * paths; a candidate locale `L` is available iff it covers every one of them.
   * This needs only the rows already in hand (no schema walk) and is correct
   * because Byline shares document structure across locales (meta rows are
   * `'all'`) — only leaf values vary per locale.
   *
   * Edge cases: an empty canonical set (the version has no localized content)
   * means any requested locale is trivially available, so the requested locale
   * is returned and the (non-localized, `'all'`) values render identically. The
   * chain always terminates at the default locale, guaranteeing a return value.
   */
  private resolveEffectiveLocale(flattenedData: FlattenedFieldValue[], chain: string[]): string {
    // biome-ignore lint/style/noNonNullAssertion: chain is non-empty by construction
    const defaultLocale = chain[chain.length - 1]!

    // Localized field paths present, grouped by locale. Skip `'all'` rows
    // (non-localized values + meta) — they don't participate in coverage.
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
      if (candidate === defaultLocale) break // terminal — return default below
      // No canonical localized content → any locale is trivially available.
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
   * _id and _type for blocks and array items inline.
   *
   * Returns `{ fields, warnings }`. When `lenient` is false (default), any
   * non-empty `warnings` are promoted to a thrown `BylineError` — preserving
   * the original strict behaviour. When `lenient` is true, the caller
   * receives the partial reconstruction and the warnings list and decides
   * how to surface them (the admin edit path uses this to render a
   * "best-effort load" banner against an out-of-date document).
   */
  private reconstructFromUnifiedRows(
    unifiedFieldValues: UnionRowValue[],
    definition: CollectionDefinition,
    locale: string,
    metaRows?: MetaRow[],
    lenient = false,
    onMissingLocale?: MissingLocalePolicy,
    sourceLocale?: string | null
  ): { fields: any; warnings: string[] } {
    const flattenedData: FlattenedFieldValue[] = unifiedFieldValues.map((row) =>
      extractFlattenedFieldValue(row as unknown as UnifiedFieldValue)
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

    // Concrete locale: with `onMissingLocale: 'fallback'`, restore the whole
    // document in a single effective locale chosen from the fallback chain
    // (never mixing locales across fields). Otherwise restore the requested
    // locale exactly — empty where untranslated, the raw per-locale view the
    // admin editor needs (`'empty'`/`'omit'`/unset). `'all'` keeps the
    // per-locale map shape (admin multi-locale read).
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
    // 1. Get current version (or current published version, per readMode)
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
    // `onMissingLocale: 'omit'` — resolve to null when the document is not
    // available in the requested locale (no version-locale ledger row).
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

    // 2. Get all field values for this document
    const unifiedFieldValues = await this.getAllFieldValues(
      document.id,
      locale,
      document.source_locale
    )

    // 3. If reconstruct is true, reconstruct the fields and attach meta
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
        created_at: document.created_at,
        updated_at: document.updated_at,
        fields,
        availableLocales: advertised ?? [],
        _availableVersionLocales: availability?.availableLocales ?? [],
        _localeAgnostic: availability?.localeAgnostic ?? false,
        ...(lenient && warnings.length > 0 ? { restoreWarnings: warnings } : {}),
      }
    }
    // Non-reconstructed: return raw flattened values
    const fieldValues = this.convertUnionRowToFlattenedStores(unifiedFieldValues)
    return {
      document_version_id: document.id,
      document_id: document.document_id,
      path: document.path ?? '',
      source_locale: document.source_locale ?? null,
      status: document.status,
      created_at: document.created_at,
      updated_at: document.updated_at,
      fields: fieldValues,
    }
  }

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
    // 1. Get current version (or current published version, per readMode)
    //
    // findByPath: resolve `(collection_id, path, locale-chain)` to a
    // document_id via the document_paths subquery, then look up the
    // current version by that id. Returns NULL when no path matches in
    // any locale, which makes the outer `=` predicate fail cleanly.
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
    // `onMissingLocale: 'omit'` — resolve to null when the document is not
    // available in the requested locale (no version-locale ledger row).
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

    // 2. Get all field values for this document
    const unifiedFieldValues = await this.getAllFieldValues(
      document.id,
      locale,
      document.source_locale
    )

    // 3. If reconstruct is true, reconstruct the fields and attach meta
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
        created_at: document.created_at,
        updated_at: document.updated_at,
        fields,
        availableLocales: advertised ?? [],
        _availableVersionLocales: availability?.availableLocales ?? [],
        _localeAgnostic: availability?.localeAgnostic ?? false,
      }
    }
    // Non-reconstructed: return raw flattened values
    const fieldValues = this.convertUnionRowToFlattenedStores(unifiedFieldValues)
    return {
      document_version_id: document.id,
      document_id: document.document_id,
      path: document.path ?? '',
      source_locale: document.source_locale ?? null,
      status: document.status,
      created_at: document.created_at,
      updated_at: document.updated_at,
      fields: fieldValues,
    }
  }

  /**
   * getDocumentByVersion — fetches a specific version and reconstructs its fields.
   */
  async getDocumentByVersion({
    document_version_id,
    locale = 'all',
  }: {
    document_version_id: string
    locale?: string
  }): Promise<any> {
    const projectionLocale = locale === 'all' ? undefined : locale
    const [document] = await this.db
      .select(this.documentVersionsProjection(projectionLocale))
      .from(documentVersions)
      .where(eq(documentVersions.id, document_version_id))

    if (document == null) {
      throw ERR_NOT_FOUND({
        message: `no current version found for document ${document_version_id}`,
        details: { documentVersionId: document_version_id },
      }).log(getLogger())
    }

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

    const documentWithFields = {
      document_version_id: document.id,
      document_id: document.document_id,
      path: document.path ?? '',
      source_locale: document.source_locale ?? null,
      status: document.status,
      created_at: document.created_at,
      updated_at: document.updated_at,
      fields,
    }

    return documentWithFields
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
    const collection = await this.db.query.collections.findFirst({
      where: eq(collections.id, collection_id),
    })

    if (collection == null || collection.config == null) {
      throw ERR_NOT_FOUND({
        message: `collection not found or missing config: ${collection_id}`,
        details: { collectionId: collection_id },
      }).log(getLogger())
    }

    const totalResult: { count: number }[] = await this.db
      .select({
        count: sql<number>`count(*)`,
      })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.collection_id, collection_id),
          eq(documentVersions.document_id, document_id)
        )
      )

    const total = Number(totalResult[0]?.count) || 0
    const total_pages = Math.ceil(total / page_size)
    const offset = (page - 1) * page_size
    // History is per-document; path is sticky so every version row has the
    // same value. `order === 'path'` is degenerate and was removed when
    // path moved to byline_document_paths — fall back to created_at.
    const orderColumn = documentVersions.created_at
    const orderFunc = desc === true ? sql`DESC` : sql`ASC`

    const projectionLocale = locale === 'all' ? undefined : locale
    const result: Document[] = await this.db
      .select(this.documentVersionsProjection(projectionLocale))
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.collection_id, collection_id),
          eq(documentVersions.document_id, document_id)
        )
      )
      .orderBy(sql`${orderColumn} ${orderFunc}`)
      .limit(page_size)
      .offset(offset)

    const history = await this.reconstructDocuments({ documents: result, locale })

    return {
      documents: history,
      meta: { total, page, page_size, total_pages, order, desc },
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
      .orderBy(sql`${documents.order_key} ASC NULLS LAST`, desc(documents.created_at))
    return rows
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
        count: sql<number>`count(*)::int`,
      })
      .from(currentDocumentsView)
      .where(and(...conditions))
      .groupBy(currentDocumentsView.status)

    return rows.map((r) => ({
      status: r.status ?? 'unknown',
      count: r.count,
    }))
  }

  /**
   * reconstructDocuments — retrieve field values and reconstruct multiple documents.
   * Supports selective field loading via the `fields` parameter.
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

    // Get field values for all versions in one query
    const allFieldValues = await this.getAllFieldValuesForMultipleVersions(
      versionIds,
      locale,
      storeTypes,
      floorLocales
    )

    // Group field values by document version
    const fieldValuesByVersion = new Map<string, UnionRowValue[]>()
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

      const documentWithFields = {
        document_version_id: doc.id,
        document_id: doc.document_id,
        path: doc.path ?? '',
        source_locale: doc.source_locale ?? null,
        status: doc.status,
        created_at: doc.created_at,
        updated_at: doc.updated_at,
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
  ): Promise<UnionRowValue[]> {
    return this.getAllFieldValuesForMultipleVersions(
      [documentVersionId],
      locale,
      undefined,
      sourceLocale ? [sourceLocale] : undefined
    )
  }

  /**
   * Gets field values for multiple versions in a single query.
   *
   * When `storeTypes` is provided, only those store tables are included in
   * the UNION ALL — this is the selective field loading optimisation for
   * list views that only need a subset of fields.
   */
  private async getAllFieldValuesForMultipleVersions(
    documentVersionIds: string[],
    locale = 'all',
    storeTypes?: Set<StoreType>,
    floorLocales?: string[]
  ): Promise<UnionRowValue[]> {
    if (documentVersionIds.length === 0) return []

    // For a concrete locale, fetch the requested locale plus every fallback
    // floor in the batch, plus non-localized `'all'` rows. The floors are the
    // documents' own `source_locale` anchors (passed by the caller, which has
    // them on the row) so a document authored in a non-default locale still
    // has its fallback rows fetched; they default to the global default when
    // unknown. Per-version effective-locale resolution (see
    // `resolveEffectiveLocale`) then picks one locale to restore from. `'all'`
    // skips the filter (admin multi-locale read).
    let localeCondition = sql``
    if (locale !== 'all') {
      const floors = floorLocales?.length ? floorLocales : [this.defaultContentLocale]
      const chain = [...new Set([locale, ...floors])]
      const chainSql = sql.join(
        chain.map((l) => sql`${l}`),
        sql`, `
      )
      localeCondition = sql`AND (locale = ANY(ARRAY[${chainSql}]::text[]) OR locale = 'all')`
    }

    const documentCondition = sql`document_version_id = ANY(ARRAY[${sql.join(
      documentVersionIds.map((id) => sql`${id}::uuid`),
      sql`, `
    )}])`

    const typesToQuery = storeTypes ?? new Set(allStoreTypes)

    // Build UNION ALL from only the required store tables.
    const fragments: SQL[] = []
    for (const st of allStoreTypes) {
      if (!typesToQuery.has(st)) continue
      fragments.push(
        sql`SELECT ${storeSelectList(st)} FROM ${sql.raw(storeTableNames[st])} WHERE ${documentCondition} ${localeCondition}`
      )
    }

    if (fragments.length === 0) return []

    // Join with UNION ALL
    let unionQuery = fragments[0]!
    for (let i = 1; i < fragments.length; i++) {
      unionQuery = sql`${unionQuery} UNION ALL ${fragments[i]}`
    }

    const query = sql`${unionQuery} ORDER BY document_version_id, field_path, locale`

    const { rows }: { rows: Record<string, unknown>[] } = await this.db.execute(query)
    return rows as unknown as UnionRowValue[]
  }

  /**
   * findDocuments — field-level filtered, sorted, paginated query.
   *
   * Each `FieldFilter` becomes an EXISTS subquery against the appropriate EAV
   * store table. A `RelationFilter` becomes a nested EXISTS that joins
   * `store_relation` to the target collection's current-documents view
   * (selected by `readMode` so draft leaks can't happen through filter
   * predicates) and recurses into its own `nested` filters. A `FieldSort`
   * becomes a LEFT JOIN LATERAL to pull the sort value into the outer query.
   * Document-level conditions (status, path) are applied directly on the
   * current_documents view.
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
    pathFilter?: { operator: string; value: string }
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

    // Text search across configured search fields via EXISTS on store_text.
    if (query) {
      const definition = await this.getDefinitionForCollection(collection_id)
      const searchFields = definition.search?.fields ?? ['title']
      const searchConditions = searchFields.map(
        (fieldName) => sql`(field_name = ${fieldName} AND value ILIKE ${`%${query}%`})`
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
        orderClause =
          sort.direction === 'desc'
            ? sql`_sort._sort_value DESC NULLS LAST`
            : sql`_sort._sort_value ASC NULLS LAST`
      } else {
        // Unrecognised store type — fall back to document-level sort
        orderClause = this.buildDocumentOrderClause(orderBy, orderDirection)
      }
    } else {
      orderClause = this.buildDocumentOrderClause(orderBy, orderDirection)
    }

    // -- Count query ----------------------------------------------------------
    const countQuery = sql`
      SELECT count(*)::int AS total
      FROM ${sourceTable} d
      ${sortJoin}
      WHERE ${whereClause}
    `
    const countResult: { rows: { total: number }[] } = await this.db.execute(countQuery)
    const total = countResult.rows[0]?.total ?? 0

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
    const { rows }: { rows: Record<string, unknown>[] } = await this.db.execute(mainQuery)

    const currentDocuments: Document[] = rows.map((row) => ({
      id: row.id as string,
      document_id: row.document_id as string,
      collection_id: row.collection_id as string,
      collection_version: row.collection_version as number,
      path: (row.path as string | null) ?? null,
      event_type: row.event_type as string,
      status: row.status as string,
      is_deleted: row.is_deleted as boolean,
      created_at: new Date(row.created_at as string | number),
      updated_at: new Date(row.updated_at as string | number),
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
   * Build an EXISTS subquery for a single DocumentFilter. Dispatches on
   * `kind` — field filters emit a direct EXISTS against the field's EAV
   * store; relation filters emit a nested EXISTS that joins through
   * `store_relation` to the target collection's current-documents view
   * and recurses against the target's own stores; combinator filters
   * emit a parenthesised AND/OR group; document-column filters emit a
   * direct comparison on the outer scope's status/path column.
   *
   * `outerScope` carries SQL references to the enclosing scope's
   * `document_version_id`, `status`, and `path` — `d.id`/`d.status`/
   * `d.path` at the top level, the equivalent column references on the
   * Drizzle view for single-doc lookups, and `td${n}.…` inside relation
   * hops. `depth` is the current relation-nesting level; each relation
   * hop bumps it so aliases stay unique across nested EXISTS scopes
   * (Postgres would otherwise resolve `td.id` to the innermost `td`,
   * silently producing the wrong rows).
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
   * freely and inherit the outer scope.
   *
   * An empty `children` array would emit `()` and produce a syntax error,
   * so callers (the parser) skip empty groups; this method assumes at
   * least one child by construction.
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
   * not in the EAV stores.
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
   * Build an EXISTS subquery for a single field-level filter.
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
   * With no nested filters this reduces to "source has any relation row
   * at all on this field pointing at a target that resolves in the
   * selected view" — useful as a base case but more typically the
   * nested list carries a predicate.
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

    const nestedAnd =
      nestedConditions.length > 0 ? sql` AND ${sql.join(nestedConditions, sql` AND `)}` : sql``

    return sql`EXISTS (
      SELECT 1 FROM byline_store_relation ${rAlias}
      JOIN ${targetView} ${tdAlias}
        ON ${tdAlias}.document_id = ${rAlias}.target_document_id
       AND ${tdAlias}.collection_id = ${rAlias}.target_collection_id
      WHERE ${rAlias}.document_version_id = ${outerScope.docVersionId}
        AND ${rAlias}.field_name = ${filter.fieldName}
        AND ${rAlias}.target_collection_id = ${filter.targetCollectionId}
        AND (${rAlias}.locale = ${locale} OR ${rAlias}.locale = 'all')${nestedAnd}
    )`
  }

  /**
   * Build a comparison condition for a filter operator.
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
        return sql`${column} ILIKE ${`%${String(value)}%`}`
      case '$in': {
        const arr = value as Array<string | number>
        // Empty `$in` matches nothing — explicit FALSE avoids generating
        // an invalid empty `IN ()` clause.
        if (arr.length === 0) return sql`FALSE`
        // Bind each element as its own parameter. Drizzle's `${arr}` would
        // serialise as a single row-constructor (`($1, $2)`), which Postgres
        // rejects when compared to a scalar column with `= ANY(...)`.
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
   * Build an ORDER BY clause for a document-level column.
   *
   * `path` is intentionally not sortable here: it lives in
   * `byline_document_paths` (locale-resolved per request) rather than on
   * the version row, so a literal `d.path` reference would refer to a
   * non-existent column. Sorting documents by URL slug has no meaningful
   * call site today; reintroduce via `pathProjection` if a real need
   * arrives.
   */
  private buildDocumentOrderClause(orderBy: string, direction: 'asc' | 'desc'): SQL {
    // `order_key` is the fractional-index column for `orderable: true`
    // collections. Always sort NULLS LAST with a `created_at DESC` tiebreaker
    // so unkeyed rows (existing rows in a newly-opted-in collection, or rows
    // from before the column existed) fall to the bottom in a stable order
    // until the editor drags them into position.
    if (orderBy === 'order_key') {
      return direction === 'desc'
        ? sql`d.order_key DESC NULLS LAST, d.created_at DESC`
        : sql`d.order_key ASC NULLS LAST, d.created_at DESC`
    }
    const columnMap: Record<string, string> = {
      created_at: 'd.created_at',
      updated_at: 'd.updated_at',
    }
    const col = columnMap[orderBy] ?? 'd.created_at'
    return direction === 'desc' ? sql`${sql.raw(col)} DESC` : sql`${sql.raw(col)} ASC`
  }

  /**
   * Converts a union field row - back into an array of FlattenedStore
   * that the reconstruction utilities expect
   */
  private convertUnionRowToFlattenedStores(unionRowValues: UnionRowValue[]): FlattenedStore[] {
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
  collections: CollectionDefinition[],
  defaultContentLocale: string
) {
  return {
    collections: new CollectionQueries(db),
    documents: new DocumentQueries(db, collections, defaultContentLocale),
  }
}
