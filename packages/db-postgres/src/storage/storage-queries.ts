/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  CollectionDefinition,
  FieldFilter,
  FieldSort,
  FlattenedStore,
  ICollectionQueries,
  IDocumentQueries,
  UnionRowValue,
} from '@byline/core'
import { and, eq, ilike, inArray, or, type SQL, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import {
  collections,
  currentDocumentsView,
  documentVersions,
  metaStore,
  textStore,
} from '../database/schema/index.js'
import type * as schema from '../database/schema/index.js'

type DatabaseConnection = NodePgDatabase<typeof schema>
type Document = Omit<typeof documentVersions.$inferSelect, 'doc'>

import {
  allStoreTypes,
  type StoreType,
  storeSelectList,
  storeTableNames,
} from './storage-store-manifest.js'
import {
  extractFlattenedFieldValue,
  resolveStoreTypes,
  restoreFieldSetData,
} from './storage-utils.js'
import type { FlattenedFieldValue, UnifiedFieldValue } from './@types.js'

interface MetaRow {
  type: string
  path: string
  item_id: string
  meta: Record<string, any> | null
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
  private collectionPathCache = new Map<string, string>()

  constructor(db: DatabaseConnection, collections: CollectionDefinition[]) {
    this.db = db
    this.collections = collections
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
        throw new Error(`Collection not found in database: ${collectionId}`)
      }
      path = row.path
      this.collectionPathCache.set(collectionId, path)
    }

    const definition = this.collections.find((c) => c.path === path)
    if (!definition) {
      throw new Error(`No CollectionDefinition found for path: ${path}`)
    }
    return definition
  }

  /**
   * Reconstruct document fields from unified row values using schema-aware
   * restoration. Meta rows (from store_meta) are converted to
   * FlattenedFieldValue entries so that restoreFieldSetData can inject
   * _id and _type for blocks and array items inline.
   */
  private reconstructFromUnifiedRows(
    unifiedFieldValues: UnionRowValue[],
    definition: CollectionDefinition,
    locale: string,
    metaRows?: MetaRow[]
  ): any {
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

    const resolveLocale = locale !== 'all' ? locale : undefined
    return restoreFieldSetData(definition.fields, flattenedData, resolveLocale)
  }

  /**
   * getAllDocuments — mainly for testing.
   */
  async getAllDocuments({
    collection_id,
    locale = 'all',
  }: {
    collection_id: string
    locale?: string
  }): Promise<any[]> {
    const localeCondition =
      locale === 'all' ? sql`TRUE` : sql`(fv.locale = ${locale} OR fv.locale = 'all')`

    // Build the UNION ALL subquery dynamically from the store manifest
    const unionFragments: SQL[] = allStoreTypes.map(
      (st) => sql`SELECT ${storeSelectList(st)} FROM ${sql.raw(storeTableNames[st])}`
    )
    let unionAll = unionFragments[0]!
    for (let i = 1; i < unionFragments.length; i++) {
      unionAll = sql`${unionAll} UNION ALL ${unionFragments[i]}`
    }

    // Optimized single query with direct JOINs
    const query = sql`
    SELECT
      d.id as document_version_id,
      d.document_id as document_id,
      d.path as document_path,
      d.status as document_status,
      fv.*
    FROM current_documents d
    LEFT JOIN (${unionAll}) fv ON d.id = fv.document_version_id AND ${localeCondition}
    WHERE d.collection_id = ${collection_id}
    ORDER BY d.id, fv.field_path NULLS LAST, fv.locale
  `

    const { rows }: { rows: Record<string, unknown>[] } = await this.db.execute(query)

    return this.groupAndReconstructDocuments(rows, locale, collection_id)
  }

  /**
   * getDocumentsByBatch — mainly for testing and migration scripts.
   */
  async getDocumentsByBatch({
    collection_id,
    batch_size = 50,
    locale = 'all',
  }: {
    collection_id: string
    batch_size?: number
    locale?: string
  }): Promise<any[]> {
    // First, get all current document version IDs for the collection
    const currentDocuments = await this.db
      .select({
        document_version_id: currentDocumentsView.id,
        document_id: currentDocumentsView.document_id,
        path: currentDocumentsView.path,
        status: currentDocumentsView.status,
      })
      .from(currentDocumentsView)
      .where(eq(currentDocumentsView.collection_id, collection_id))
      .orderBy(currentDocumentsView.path) // Add consistent ordering

    if (currentDocuments.length === 0) return []

    // Process documents in batches
    const result: any[] = []
    const documentVersionIds = currentDocuments.map((doc) => doc.document_version_id)

    for (let i = 0; i < documentVersionIds.length; i += batch_size) {
      const batch = documentVersionIds.slice(i, i + batch_size)
      const batchResults = await this.getDocumentsByVersionIds({
        document_version_ids: batch,
        locale,
      })

      // Add batch results to final result array
      result.push(...batchResults)
    }

    return result
  }

  /**
   * getDocumentsByPage
   *
   * Paginated query to get current documents for a collection.
   * Search is driven by `CollectionDefinition.search.fields` (defaults to ['title']).
   */
  async getDocumentsByPage({
    collection_id,
    locale = 'all',
    page = 1,
    page_size = 20,
    order = 'created_at',
    desc = true,
    query,
    status,
    fields,
  }: {
    collection_id: string
    locale?: string
    page?: number
    page_size?: number
    order?: string
    desc?: boolean
    query?: string
    status?: string
    fields?: string[]
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
  }> {
    const collection = await this.db.query.collections.findFirst({
      where: eq(collections.id, collection_id),
    })

    if (collection == null || collection.config == null) {
      throw new Error(`Collection with ID ${collection_id} not found or missing collection config.`)
    }

    const config = collection.config as CollectionDefinition

    // Build reusable WHERE conditions.
    const statusCondition = status ? eq(currentDocumentsView.status, status) : undefined

    // Resolve which text fields are searchable for this collection.
    const searchFields = config.search?.fields ?? ['title']

    // Build a search condition that ORs across all configured search fields.
    // Each field becomes: (field_name = 'x' AND value ILIKE '%query%')
    const buildSearchCondition = (q: string) =>
      or(
        ...searchFields.map((fieldName) =>
          and(eq(textStore.field_name, fieldName), ilike(textStore.value, `%${q}%`))
        )
      )

    let totalResult: { count: number }[]
    if (query) {
      totalResult = await this.db
        .select({
          count: sql<number>`count(DISTINCT ${currentDocumentsView.id})`,
        })
        .from(currentDocumentsView)
        .leftJoin(textStore, eq(currentDocumentsView.id, textStore.document_version_id))
        .where(
          and(
            eq(currentDocumentsView.collection_id, collection_id),
            buildSearchCondition(query),
            statusCondition
          )
        )
    } else {
      totalResult = await this.db
        .select({
          count: sql<number>`count(*)`,
        })
        .from(currentDocumentsView)
        .where(and(eq(currentDocumentsView.collection_id, collection_id), statusCondition))
    }

    const total = Number(totalResult[0]?.count) || 0
    const total_pages = Math.ceil(total / page_size)
    const offset = (page - 1) * page_size
    const orderColumn =
      order === 'path' ? currentDocumentsView.path : currentDocumentsView.created_at
    const orderFunc = desc === true ? sql`DESC` : sql`ASC`

    let currentDocuments: Document[] = []
    if (query) {
      currentDocuments = await this.db
        .select({
          id: currentDocumentsView.id,
          document_id: currentDocumentsView.document_id,
          collection_id: currentDocumentsView.collection_id,
          path: currentDocumentsView.path,
          event_type: currentDocumentsView.event_type,
          status: currentDocumentsView.status,
          is_deleted: currentDocumentsView.is_deleted,
          created_at: currentDocumentsView.created_at,
          updated_at: currentDocumentsView.updated_at,
          created_by: currentDocumentsView.created_by,
          change_summary: currentDocumentsView.change_summary,
        })
        .from(currentDocumentsView)
        .leftJoin(textStore, eq(currentDocumentsView.id, textStore.document_version_id))
        .where(
          and(
            eq(currentDocumentsView.collection_id, collection_id),
            buildSearchCondition(query),
            statusCondition
          )
        )
        .orderBy(sql`${orderColumn} ${orderFunc}`)
        .limit(page_size)
        .offset(offset)
    } else {
      currentDocuments = await this.db
        .select()
        .from(currentDocumentsView)
        .where(and(eq(currentDocumentsView.collection_id, collection_id), statusCondition))
        .orderBy(sql`${orderColumn} ${orderFunc}`)
        .limit(page_size)
        .offset(offset)
    }

    const documents = await this.reconstructDocuments({
      documents: currentDocuments,
      locale,
      fields,
    })

    // Determine which documents in this page have a published version anywhere
    // in their version history. This powers the "live" indicator in the list UI.
    const documentIds = currentDocuments.map((d) => d.document_id)
    const publishedSet = new Set<string>()
    if (documentIds.length > 0) {
      const publishedRows = await this.db
        .select({ document_id: documentVersions.document_id })
        .from(documentVersions)
        .where(
          and(
            inArray(documentVersions.document_id, documentIds),
            eq(documentVersions.status, 'published'),
            eq(documentVersions.is_deleted, false)
          )
        )
        .groupBy(documentVersions.document_id)
      for (const row of publishedRows) {
        publishedSet.add(row.document_id)
      }
    }

    // Attach the flag to each document.
    for (const doc of documents) {
      ;(doc as any).has_published_version = publishedSet.has((doc as any).document_id)
    }

    return {
      documents,
      meta: { total, page, page_size, total_pages, order, desc, query },
      included: {
        collection: {
          id: collection.id,
          path: collection.path,
          labels: {
            singular: config.labels.singular || collection.path,
            plural: config.labels.plural || collection.path,
          },
        },
      },
    }
  }

  /**
   * getDocumentById — gets the current version of a document by its logical document ID.
   */
  async getDocumentById({
    collection_id,
    document_id,
    locale = 'en',
    reconstruct = true,
  }: {
    collection_id: string
    document_id: string
    locale?: string
    reconstruct?: boolean
  }) {
    // 1. Get current version
    const [document] = await this.db
      .select()
      .from(currentDocumentsView)
      .where(
        and(
          eq(currentDocumentsView.collection_id, collection_id),
          eq(currentDocumentsView.document_id, document_id)
        )
      )

    if (document == null) {
      return null
    }

    // 2. Get all field values for this document
    const unifiedFieldValues = await this.getAllFieldValues(document.id, locale)

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

      const fields = this.reconstructFromUnifiedRows(
        unifiedFieldValues,
        definition,
        locale,
        metaRows as MetaRow[]
      )

      return {
        document_version_id: document.id,
        document_id: document.document_id,
        path: document.path,
        status: document.status,
        created_at: document.created_at,
        updated_at: document.updated_at,
        fields,
      }
    }
    // Non-reconstructed: return raw flattened values
    const fieldValues = this.convertUnionRowToFlattenedStores(unifiedFieldValues)
    return {
      document_version_id: document.id,
      document_id: document.document_id,
      path: document.path,
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
  }: {
    collection_id: string
    path: string
    locale?: string
    reconstruct: boolean
  }) {
    // 1. Get current version
    const [document] = await this.db
      .select()
      .from(currentDocumentsView)
      .where(
        and(
          eq(currentDocumentsView.collection_id, collection_id),
          eq(currentDocumentsView.path, path)
        )
      )

    if (document == null) {
      throw new Error(`Document not found at path: ${path}`)
    }

    // 2. Get all field values for this document
    const unifiedFieldValues = await this.getAllFieldValues(document.id, locale)

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

      const fields = this.reconstructFromUnifiedRows(
        unifiedFieldValues,
        definition,
        locale,
        metaRows as MetaRow[]
      )

      return {
        document_version_id: document.id,
        document_id: document.document_id,
        path: document.path,
        status: document.status,
        created_at: document.created_at,
        updated_at: document.updated_at,
        fields,
      }
    }
    // Non-reconstructed: return raw flattened values
    const fieldValues = this.convertUnionRowToFlattenedStores(unifiedFieldValues)
    return {
      document_version_id: document.id,
      document_id: document.document_id,
      path: document.path,
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
    const document = await this.db.query.documentVersions.findFirst({
      where: eq(documentVersions.id, document_version_id),
    })

    if (document == null) {
      throw new Error(`No current version found for document ${document_version_id}`)
    }

    const unifiedFieldValues = await this.getAllFieldValues(document.id, locale)
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

    const enrichedDocument = this.reconstructFromUnifiedRows(
      unifiedFieldValues,
      definition,
      locale,
      metaRows as MetaRow[]
    )

    const documentWithFields = {
      document_version_id: document.id,
      document_id: document.document_id,
      path: document.path,
      status: document.status,
      created_at: document.created_at,
      updated_at: document.updated_at,
      fields: enrichedDocument,
    }

    return documentWithFields
  }

  /**
   * getDocumentsByVersionIds — fetches and reconstructs multiple documents by
   * version ID. Used for batch loading (e.g. relationship population).
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
      .select({
        document_version_id: documentVersions.id,
        document_id: documentVersions.document_id,
        collection_id: documentVersions.collection_id,
        path: documentVersions.path,
        status: documentVersions.status,
        created_at: documentVersions.created_at,
        updated_at: documentVersions.updated_at,
      })
      .from(documentVersions)
      .where(inArray(documentVersions.id, document_version_ids))

    if (docs.length === 0) return []

    // Get all field values for all versions in one query
    const versionIds = docs.map((v) => v.document_version_id)

    const allFieldValues = await this.getAllFieldValuesForMultipleVersions(versionIds, locale)

    // Group field values by document version
    const fieldValuesByVersion = new Map<string, UnionRowValue[]>()
    for (const fieldValue of allFieldValues) {
      if (!fieldValuesByVersion.has(fieldValue.document_version_id)) {
        fieldValuesByVersion.set(fieldValue.document_version_id, [])
      }
      fieldValuesByVersion.get(fieldValue.document_version_id)?.push(fieldValue)
    }

    // Resolve definition once for the batch (safe — early return above guarantees length > 0)
    const firstDoc = docs[0]!
    const definition = await this.getDefinitionForCollection(firstDoc.collection_id ?? '')

    // Reconstruct each document with document data at root level and attach meta
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
    for (const doc of docs) {
      const versionFieldValues = fieldValuesByVersion.get(doc.document_version_id) || []
      const docMetaRows = (metaByVersion.get(doc.document_version_id) ?? []) as MetaRow[]
      const fields = this.reconstructFromUnifiedRows(
        versionFieldValues,
        definition,
        locale,
        docMetaRows
      )

      const documentWithFields = {
        document_version_id: doc.document_version_id,
        document_id: doc.document_id,
        path: doc.path,
        status: doc.status,
        created_at: doc.created_at,
        updated_at: doc.updated_at,
        fields,
      }

      result.push(documentWithFields)
    }

    return result
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
      throw new Error(`Collection with ID ${collection_id} not found or missing collection config.`)
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
    const orderColumn = order === 'path' ? documentVersions.path : documentVersions.created_at
    const orderFunc = desc === true ? sql`DESC` : sql`ASC`

    const result: Document[] = await this.db
      .select()
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
   * getDocumentCountsByStatus
   *
   * Returns a count of current documents grouped by workflow status for a
   * given collection. Uses the `current_documents` view so each logical
   * document is counted once (at its latest/current version).
   */
  async getDocumentCountsByStatus({
    collection_id,
  }: {
    collection_id: string
  }): Promise<Array<{ status: string; count: number }>> {
    const rows = await this.db
      .select({
        status: currentDocumentsView.status,
        count: sql<number>`count(*)::int`,
      })
      .from(currentDocumentsView)
      .where(eq(currentDocumentsView.collection_id, collection_id))
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
  }: {
    documents: Document[]
    locale?: string
    fields?: string[]
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

    // Get field values for all versions in one query
    const allFieldValues = await this.getAllFieldValuesForMultipleVersions(
      versionIds,
      locale,
      storeTypes
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
      const fields = this.reconstructFromUnifiedRows(
        versionFieldValues,
        definition,
        locale,
        docMetaRows
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
        path: doc.path,
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
   * Helper method to group results by document and reconstruct each document
   * Returns an array of complete documents
   */
  private async groupAndReconstructDocuments(
    rows: Record<string, unknown>[],
    locale: string,
    collection_id: string
  ): Promise<any[]> {
    // Group rows by document ID
    const documentGroups = new Map<
      string,
      {
        document: { document_version_id: string; document_id: string; path: string; status: string }
        fieldValues: UnionRowValue[]
      }
    >()

    for (const row of rows) {
      const documentVersionId = row.document_version_id as string

      if (!documentGroups.has(documentVersionId)) {
        documentGroups.set(documentVersionId, {
          document: {
            document_version_id: documentVersionId,
            document_id: row.document_id as string,
            path: row.document_path as string,
            status: row.document_status as string,
          },
          fieldValues: [],
        })
      }

      // Only add field values if they exist (LEFT JOIN can return null field values)
      if (row.id) {
        const fieldValue: UnionRowValue = {
          id: row.id as string,
          document_version_id: row.document_version_id as string,
          collection_id: row.collection_id as string,
          field_type: row.field_type as string,
          field_path: row.field_path as string,
          field_name: row.field_name as string,
          locale: row.locale as string,
          parent_path: row.parent_path as string | null,
          text_value: row.text_value as string | null,
          boolean_value: row.boolean_value as boolean | null,
          json_value: row.json_value as any,
          date_type: row.date_type as string | null,
          value_date: row.value_date as Date | null,
          value_time: row.value_time as string | null,
          value_timestamp_tz: row.value_timestamp_tz as Date | null,
          file_id: row.file_id as string | null,
          filename: row.filename as string | null,
          original_filename: row.original_filename as string | null,
          mime_type: row.mime_type as string | null,
          file_size: row.file_size as number | null,
          storage_provider: row.storage_provider as string | null,
          storage_path: row.storage_path as string | null,
          storage_url: row.storage_url as string | null,
          file_hash: row.file_hash as string | null,
          image_width: row.image_width as number | null,
          image_height: row.image_height as number | null,
          image_format: row.image_format as string | null,
          processing_status: row.processing_status as string | null,
          thumbnail_generated: row.thumbnail_generated as boolean | null,
          target_document_id: row.target_document_id as string | null,
          target_collection_id: row.target_collection_id as string | null,
          relationship_type: row.relationship_type as string | null,
          cascade_delete: row.cascade_delete as boolean | null,
          json_schema: row.json_schema as string | null,
          object_keys: row.object_keys as string[] | null,
          number_type: row.number_type as string | null,
          value_integer: row.value_integer as number | null,
          value_decimal: row.value_decimal as string | null,
          value_float: row.value_float as number | null,
        }

        documentGroups.get(documentVersionId)?.fieldValues.push(fieldValue)
      }
    }

    // Resolve definition once for the batch
    const definition = await this.getDefinitionForCollection(collection_id)

    // Reconstruct each document and return as array
    const result: any[] = []

    for (const [_documentId, group] of documentGroups) {
      const head = {
        document_version_id: group.document.document_version_id,
        document_id: group.document.document_id,
        path: group.document.path,
        status: group.document.status,
      }

      const fields = this.reconstructFromUnifiedRows(group.fieldValues, definition, locale)

      result.push({ ...head, fields })
    }

    // Sort by document path for consistent ordering
    return result.sort((a, b) => (a.path || '').localeCompare(b.path || ''))
  }

  /**
   * Gets all field values for a single document version.
   * Delegates to the multi-version dynamic UNION ALL builder.
   */
  private async getAllFieldValues(
    documentVersionId: string,
    locale = 'all'
  ): Promise<UnionRowValue[]> {
    return this.getAllFieldValuesForMultipleVersions([documentVersionId], locale)
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
    storeTypes?: Set<StoreType>
  ): Promise<UnionRowValue[]> {
    if (documentVersionIds.length === 0) return []

    const localeCondition =
      locale === 'all' ? sql`` : sql`AND (locale = ${locale} OR locale = 'all')`

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
   * Each FieldFilter becomes an EXISTS subquery against the appropriate EAV
   * store table. A FieldSort becomes a LEFT JOIN LATERAL to pull the sort
   * value into the outer query. Document-level conditions (status, path)
   * are applied directly on the current_documents view.
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
  }: {
    collection_id: string
    filters?: FieldFilter[]
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
  }): Promise<{ documents: any[]; total: number }> {
    const offset = (page - 1) * pageSize

    // -- Build WHERE conditions -----------------------------------------------
    const conditions: SQL[] = [sql`d.collection_id = ${collection_id}`]

    if (status) {
      conditions.push(sql`d.status = ${status}`)
    }

    if (pathFilter) {
      conditions.push(
        this.buildDocumentLevelCondition('d.path', pathFilter.operator, pathFilter.value)
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
        SELECT 1 FROM store_text
        WHERE document_version_id = d.id
          AND (locale = ${locale} OR locale = 'all')
          AND (${sql.join(searchConditions, sql` OR `)})
      )`)
    }

    // Field-level EXISTS subqueries
    for (const filter of filters) {
      conditions.push(this.buildExistsSubquery(filter, locale))
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
      FROM current_documents d
      ${sortJoin}
      WHERE ${whereClause}
    `
    const countResult: { rows: { total: number }[] } = await this.db.execute(countQuery)
    const total = countResult.rows[0]?.total ?? 0

    if (total === 0) {
      return { documents: [], total: 0 }
    }

    // -- Main query -----------------------------------------------------------
    const mainQuery = sql`
      SELECT d.*
      FROM current_documents d
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
      path: row.path as string,
      event_type: row.event_type as string,
      status: row.status as string,
      is_deleted: row.is_deleted as boolean,
      created_at: row.created_at as Date,
      updated_at: row.updated_at as Date,
      created_by: row.created_by as string,
      change_summary: row.change_summary as string,
    }))

    const documents = await this.reconstructDocuments({
      documents: currentDocuments,
      locale,
      fields: requestedFields,
    })

    return { documents, total }
  }

  /**
   * Build an EXISTS subquery for a single field-level filter.
   */
  private buildExistsSubquery(filter: FieldFilter, locale: string): SQL {
    const storeTable = storeTableNames[filter.storeType as StoreType]
    if (!storeTable) {
      throw new Error(`Unknown store type: ${filter.storeType}`)
    }

    const valueCol = sql.raw(filter.valueColumn)
    const condition = this.buildFilterCondition(valueCol, filter.operator, filter.value)

    return sql`EXISTS (
      SELECT 1 FROM ${sql.raw(storeTable)}
      WHERE document_version_id = d.id
        AND field_name = ${filter.fieldName}
        AND (locale = ${locale} OR locale = 'all')
        AND ${condition}
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
        return sql`${column} = ANY(${arr})`
      }
      case '$nin': {
        const arr = value as Array<string | number>
        return sql`${column} != ALL(${arr})`
      }
      default:
        throw new Error(`Unsupported filter operator: ${operator}`)
    }
  }

  /**
   * Build a condition for a document-level column (status, path).
   */
  private buildDocumentLevelCondition(column: string, operator: string, value: string): SQL {
    const col = sql.raw(column)
    return this.buildFilterCondition(col, operator, value)
  }

  /**
   * Build an ORDER BY clause for a document-level column.
   */
  private buildDocumentOrderClause(orderBy: string, direction: 'asc' | 'desc'): SQL {
    const columnMap: Record<string, string> = {
      created_at: 'd.created_at',
      updated_at: 'd.updated_at',
      path: 'd.path',
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
          throw new Error(`Unknown field type: ${row.field_type}`)
      }
    }) as FlattenedStore[]
  }
}

export function createQueryBuilders(db: DatabaseConnection, collections: CollectionDefinition[]) {
  return {
    collections: new CollectionQueries(db),
    documents: new DocumentQueries(db, collections),
  }
}
