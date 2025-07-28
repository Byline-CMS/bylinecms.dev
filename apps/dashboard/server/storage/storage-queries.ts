/**
 * Byline CMS Server Tests
 * 
 * Optimized Storage Queries - Single Query Approach with UNION ALL
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from '../../database/schema/index.js'
import { collections, currentDocumentsView, documents } from '../../database/schema/index.js';

type DatabaseConnection = NodePgDatabase<typeof schema>;

import type { CollectionDefinition } from "@byline/byline";
import { queryObjects } from "v8";
import type {
  FlattenedStore,
  UnionRowValue
} from '../@types/index.js'
import {
  booleanFields,
  datetimeFields,
  fileFields,
  jsonFields,
  numericFields,
  relationFields,
  textFields
} from './storage-template-queries.js';
import { reconstructFields } from './storage-utils.js';

/**
 * CollectionQueries
 */
export class CollectionQueries {
  constructor(private db: DatabaseConnection) { }

  /**
   * getAllCollections
   * 
   * @returns 
   */
  async getAllCollections() {
    return await this.db.select().from(collections);
  }

  /**
   * getCollectionByPath
   * 
   * @param path 
   * @returns 
   */
  async getCollectionByPath(path: string) {
    return this.db.query.collections.findFirst({ where: eq(collections.path, path) });
  }

  /**
   * getCollectionById
   * 
   * @param id 
   * @returns 
   */
  async getCollectionById(id: string) {
    return this.db.query.collections.findFirst({ where: eq(collections.id, id) });
  }
}


/**
 * DocumentQueries
 */
export class DocumentQueries {
  constructor(private db: DatabaseConnection) { }

  /**
   * getAllDocuments
   * 
   * Unlikely to use this. Here mainly for testing.
   * 
   * @param collectionId 
   * @param locale 
   * @returns 
   */
  async getAllDocuments({
    collection_id,
    locale = 'all'
  }: {
    collection_id: string;
    locale?: string;
  }): Promise<any[]> {
    const localeCondition = locale === 'all'
      ? sql`TRUE`
      : sql`(fv.locale = ${locale} OR fv.locale = 'all')`;

    // Optimized single query with direct JOINs
    const query = sql`
    SELECT 
      d.id as document_version_id,
      d.document_id as document_id,
      d.path as document_path,
      d.status as document_status,
      fv.id,
      fv.collection_id,
      fv.field_type,
      fv.field_path,
      fv.field_name,
      fv.locale,
      fv.parent_path,
      fv.text_value,
      fv.boolean_value,
      fv.json_value,
      fv.date_type,
      fv.value_date,
      fv.value_time,
      fv.value_timestamp_tz,
      fv.file_id,
      fv.filename,
      fv.original_filename,
      fv.mime_type,
      fv.file_size,
      fv.storage_provider,
      fv.storage_path,
      fv.storage_url,
      fv.file_hash,
      fv.image_width,
      fv.image_height,
      fv.image_format,
      fv.processing_status,
      fv.thumbnail_generated,
      fv.target_document_id,
      fv.target_collection_id,
      fv.relationship_type,
      fv.cascade_delete,
      fv.json_schema,
      fv.object_keys,
      fv.number_type,
      fv.value_integer,
      fv.value_decimal,
      fv.value_float
    FROM current_documents d
    LEFT JOIN (
      -- Text fields
      SELECT 
        ${textFields}
      FROM store_text

      UNION ALL

      -- Numeric fields
      SELECT 
        ${numericFields}
      FROM store_numeric

      UNION ALL

      -- Boolean fields
      SELECT 
        ${booleanFields}
      FROM store_boolean

      UNION ALL

      -- DateTime fields
      SELECT 
        ${datetimeFields}
      FROM store_datetime

      UNION ALL

      -- JSON fields
      SELECT 
        ${jsonFields}
      FROM store_json

      UNION ALL

      -- Relation fields
      SELECT 
        ${relationFields}
      FROM store_relation

      UNION ALL

      -- File fields
      SELECT 
        ${fileFields}
      FROM store_file
    ) fv ON d.id = fv.document_version_id AND ${localeCondition}
    WHERE d.collection_id = ${collection_id}
    ORDER BY d.id, fv.field_path NULLS LAST, fv.locale
  `;

    const { rows }: { rows: Record<string, unknown>[] } = await this.db.execute(query);

    return this.groupAndReconstructDocuments(rows, locale);
  }

  /**
   * getDocumentsByBatch
   * 
   * Also unlikely to use often. Mainly for testing and perhaps migration scripts.
   * 
   * @param collectionId 
   * @param locale 
   * @param batchSize 
   * @returns 
   */
  async getDocumentsByBatch({
    collection_id,
    batch_size = 50,
    locale = 'all'
  }: {
    collection_id: string;
    batch_size?: number;
    locale?: string;
  }): Promise<any[]> {
    // First, get all current document version IDs for the collection
    const currentDocuments = await this.db.select({
      document_version_id: currentDocumentsView.id,
      document_id: currentDocumentsView.document_id,
      path: currentDocumentsView.path,
      status: currentDocumentsView.status,
    })
      .from(currentDocumentsView)
      .where(eq(currentDocumentsView.collection_id, collection_id))
      .orderBy(currentDocumentsView.path); // Add consistent ordering

    if (currentDocuments.length === 0) return [];

    // Process documents in batches
    const result: any[] = [];
    const documentVersionIds = currentDocuments.map(doc => doc.document_version_id);

    for (let i = 0; i < documentVersionIds.length; i += batch_size) {
      const batch = documentVersionIds.slice(i, i + batch_size);
      const batchResults = await this.getDocuments({ document_version_ids: batch, locale });

      // Add batch results to final result array
      result.push(...batchResults);
    }

    return result;
  }

  /**
   * getDocumentsByPage
   * 
   * Paginated query to get current documents for a collection
   * 
   * TODO: Parameter and return types
   * 
   * @param collectionId 
   * @param options 
   * @returns 
   */
  async getDocumentsByPage({
    collection_id,
    locale = 'all',
    page = 1,
    page_size = 20,
    order = 'created_at',
    desc = true,
    query
  }: {
    collection_id: string;
    locale?: string;
    page?: number;
    page_size?: number;
    order?: string;
    desc?: boolean;
    query?: string;
  }): Promise<{
    documents: any[];
    meta: {
      total: number;
      page: number;
      page_size: number;
      total_pages: number;
      order: string;
      desc: boolean;
      query?: string
    };
    included: {
      collection: {
        id: string;
        path: string,
        labels: {
          singular: string;
          plural: string;
        }
      }
    }
  }> {
    const collection = await this.db.query.collections.findFirst({
      where: eq(collections.id, collection_id)
    });

    if (collection == null || collection.config == null
    ) {
      throw new Error(`Collection with ID ${collection_id} not found or missing collection config.`);
    }

    const config = collection.config as CollectionDefinition;

    // First get total count
    const totalResult = await this.db.select({
      count: sql<number>`count(*)`,
    })
      .from(currentDocumentsView)
      .where(eq(currentDocumentsView.collection_id, collection_id)
      );


    const total = Number(totalResult[0]?.count) || 0;
    const total_pages = Math.ceil(total / page_size);
    const offset = (page - 1) * page_size;

    // Get paginated document IDs
    const orderColumn = order === 'path' ? currentDocumentsView.path : currentDocumentsView.created_at;
    const orderFunc = desc === true ? sql`DESC` : sql`ASC`;

    const versionIdsPerPage = await this.db.select({
      id: currentDocumentsView.id,
    })
      .from(currentDocumentsView)
      .where(eq(currentDocumentsView.collection_id, collection_id),
      )
      .orderBy(sql`${orderColumn} ${orderFunc}`)
      .limit(page_size)
      .offset(offset);

    const documentVersionIds = versionIdsPerPage.map(doc => doc.id);
    const documents = await this.getDocuments({ document_version_ids: documentVersionIds, locale });

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
          }
        }
      }
    };
  }

  /**
   * getDocumentById
   * 
   * Get's the current version of a document by its logical document ID.
   * 
   * @param collection_id 
   * @param document_id 
   * @returns 
   */
  async getDocumentById({
    collection_id,
    document_id,
    locale = 'en',
    reconstruct = true
  }: {
    collection_id: string;
    document_id: string;
    locale?: string;
    reconstruct?: boolean;
  }) {
    // 1. Get current version
    const [document] = await this.db.select()
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
    const unifiedFieldValues = await this.getAllFieldValues(
      document.id,
      locale
    );

    // 3. Convert unified values back to FlattenedStore format
    const fieldValues = this.convertUnionRowToFlattenedStores(unifiedFieldValues);

    // 4. If reconstruct is true, reconstruct the fields
    if (reconstruct === true) {
      const reconstructedFields = reconstructFields(
        fieldValues,
        locale
      );

      return {
        document_version_id: document.id,
        document_id: document.document_id,
        path: document.path,
        status: document.status,
        created_at: document.created_at,
        updated_at: document.updated_at,
        ...reconstructedFields
      };
    }
    return {
      document_version_id: document.id,
      document_id: document.document_id,
      path: document.path,
      status: document.status,
      created_at: document.created_at,
      updated_at: document.updated_at,
      fields: fieldValues
    };
  }

  /**
   * getDocumentByPath
   * 
   * @param collection_id 
   * @param path 
   * @returns 
   */
  async getDocumentByPath({
    collection_id,
    path,
    locale = 'en',
    reconstruct = true
  }: {
    collection_id: string;
    path: string;
    locale?: string;
    reconstruct: boolean;
  }) {
    // 1. Get current version
    const [document] = await this.db.select()
      .from(currentDocumentsView)
      .where(
        and(
          eq(currentDocumentsView.collection_id, collection_id),
          eq(currentDocumentsView.path, path)
        )
      )

    if (document == null) {
      throw new Error(`Document not found at path: ${path}`);
    }

    // 2. Get all field values for this document
    const unifiedFieldValues = await this.getAllFieldValues(
      document.id,
      locale
    );

    // 3. Convert unified values back to FlattenedStore format
    const fieldValues = this.convertUnionRowToFlattenedStores(unifiedFieldValues);

    // 4. If reconstruct is true, reconstruct the fields
    if (reconstruct === true) {
      // 4. Reconstruct field values for document
      const reconstructedFields = reconstructFields(
        fieldValues,
        locale
      );

      return {
        document_version_id: document.id,
        document_id: document.document_id,
        path: document.path,
        status: document.status,
        created_at: document.created_at,
        updated_at: document.updated_at,
        ...reconstructedFields
      };
    }
    return {
      document_version_id: document.id,
      document_id: document.document_id,
      path: document.path,
      status: document.status,
      created_at: document.created_at,
      updated_at: document.updated_at,
      fields: fieldValues
    };
  }

  /**
   * getCurrentDocument
   */
  async getDocumentByVersion({
    document_version_id,
    locale = 'all'
  }: {
    document_version_id: string;
    locale?: string;
  }): Promise<any> {
    // 1. Get current version. We can query the documents table directly
    // since its primary key is the document version (no need to use
    // the currentDocumentsView).
    const document = await this.db.query.documents.findFirst({
      where: eq(documents.id, document_version_id)
    });

    if (document == null) {
      throw new Error(`No current version found for document ${document_version_id}`);
    }

    // 2. Get all field values in a single query using UNION ALL
    const unifiedFieldValues = await this.getAllFieldValues(
      document.id,
      locale
    );

    // 3. Convert unified values back to FlattenedStore format
    const fieldValues = this.convertUnionRowToFlattenedStores(unifiedFieldValues);

    const reconstructedFields = reconstructFields(
      fieldValues,
      locale
    );

    // Add document properties at root level
    const documentWithFields = {
      document_version_id: document.id,
      document_id: document.document_id,
      path: document.path,
      status: document.status,
      created_at: document.created_at,
      updated_at: document.updated_at,
      ...reconstructedFields
    };

    return documentWithFields
  }

  /** 
   * getDocuments (multiple)
   * 
   * Primary used to get documents that have been selected by page,
   * batch, or cursor.
   *
   * @param documentVersionIds 
   * @param locale 
   * @returns 
   */
  async getDocuments({
    document_version_ids,
    locale = 'all'
  }: {
    document_version_ids: string[];
    locale?: string;
  }): Promise<any[]> {
    if (document_version_ids.length === 0) return [];

    // Get current documents
    // Again here we can use the documents table directly
    // since its primary key is the document version, and we are 
    // supplying an array of document version IDs (as opposed to 
    // logical document IDs).
    const docs = await this.db.select({
      document_version_id: documents.id,
      document_id: documents.document_id,
      path: documents.path,
      status: documents.status,
      created_at: documents.created_at,
      updated_at: documents.updated_at,
    })
      .from(documents)
      .where(inArray(documents.id, document_version_ids));

    if (docs.length === 0) return [];

    // Get all field values for all versions in one query
    const versionIds = docs.map(v => v.document_version_id);

    const allFieldValues = await this.getAllFieldValuesForMultipleVersions(
      versionIds,
      locale
    );

    // Group field values by document version
    const fieldValuesByVersion = new Map<string, UnionRowValue[]>();
    for (const fieldValue of allFieldValues) {
      if (!fieldValuesByVersion.has(fieldValue.document_version_id)) {
        fieldValuesByVersion.set(fieldValue.document_version_id, []);
      }
      fieldValuesByVersion.get(fieldValue.document_version_id)?.push(fieldValue);
    }

    // Reconstruct each document with document data at root level
    const result: any[] = [];
    for (const doc of docs) {
      const versionFieldValues = fieldValuesByVersion.get(doc.document_version_id) || [];
      const flattenedFieldValues = this.convertUnionRowToFlattenedStores(versionFieldValues);

      const reconstructedFields = reconstructFields(
        flattenedFieldValues,
        locale
      );

      // Add document data at root level
      const documentWithFields = {
        document_version_id: doc.document_version_id,
        document_id: doc.document_id,
        path: doc.path,
        status: doc.status,
        created_at: doc.created_at,
        updated_at: doc.updated_at,
        ...reconstructedFields
      };

      result.push(documentWithFields);
    }

    // Sort by document path for consistent ordering
    // TODO: Is this necessary? We should likely sort by timestamp or
    // created_at in the document query above.
    return result.sort((a, b) => (a.path || '').localeCompare(b.path || ''));
  }

  /**
   * getDocumentHistory
   * 
   * Gets the history of a document version by its logical document ID. This will
   * included any 'soft deleted' documents as well.
   * 
   * @param documentId 
   * @param collectionId 
   * @returns 
   */
  async getDocumentHistory({
    collection_id,
    document_id
  }: {
    collection_id: string;
    document_id: string;
  }): Promise<any[]> {
    // Get all versions of the document
    const docs = await this.db.select({
      document_version_id: documents.id,
      document_id: documents.document_id,
      action: documents.event_type,
      is_deleted: documents.is_deleted,
      path: documents.path,
      status: documents.status,
      created_at: documents.created_at,
      updated_at: documents.updated_at,
    }).from(documents)
      .where(
        and(
          eq(documents.document_id, document_id),
          eq(documents.collection_id, collection_id)
        )
      ).orderBy(desc(documents.id));
    // Since document version ids are UUID7s we can order descending 
    // by version ID to get the most recent first

    return docs
  }

  /**
 * Helper method to group results by document and reconstruct each document
 * Returns an array of complete documents
 */
  private groupAndReconstructDocuments(
    rows: Record<string, unknown>[],
    locale: string
  ): any[] {
    // Group rows by document ID
    const documentGroups = new Map<string, {
      document: { document_version_id: string; document_id: string; path: string; status: string };
      fieldValues: UnionRowValue[];
    }>();

    for (const row of rows) {
      const documentVersionId = row.document_version_id as string;

      if (!documentGroups.has(documentVersionId)) {
        documentGroups.set(documentVersionId, {
          document: {
            document_version_id: documentVersionId,
            document_id: row.document_id as string,
            path: row.document_path as string,
            status: row.document_status as string,
          },
          fieldValues: []
        });
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
        };

        documentGroups.get(documentVersionId)?.fieldValues.push(fieldValue);
      }
    }

    // Reconstruct each document and return as array
    const result: any[] = [];

    for (const [documentId, group] of documentGroups) {
      const flattenedFieldValues = this.convertUnionRowToFlattenedStores(group.fieldValues);

      const head = {
        document_version_id: group.document.document_version_id,
        document_id: group.document.document_id,
        path: group.document.path,
        status: group.document.status
      }

      const document = reconstructFields(
        flattenedFieldValues,
        locale
      );

      result.push({ ...head, ...document });
    }

    // Sort by document path for consistent ordering
    return result.sort((a, b) => (a.__meta?.path || '').localeCompare(b.__meta?.path || ''));
  }

  /**
   * Gets all field values using a single UNION ALL query
   */
  private async getAllFieldValues(
    documentVersionId: string,
    locale = 'all'
  ): Promise<UnionRowValue[]> {
    const localeCondition = locale === 'all'
      ? sql``
      : sql`AND (locale = ${locale} OR locale = 'all')`;

    const query = sql`
      -- Text fields (41 columns total)
      SELECT 
        ${textFields}
      FROM store_text 
      WHERE document_version_id = ${documentVersionId} ${localeCondition}

      UNION ALL

      -- Numeric fields (41 columns total - SAME ORDER)
      SELECT 
        ${numericFields}
      FROM store_numeric 
      WHERE document_version_id = ${documentVersionId} ${localeCondition}

      UNION ALL

      -- Boolean fields (41 columns total - SAME ORDER)
      SELECT 
        ${booleanFields}
      FROM store_boolean 
      WHERE document_version_id = ${documentVersionId} ${localeCondition}

      UNION ALL

      -- DateTime fields (41 columns total - SAME ORDER)
      SELECT 
        ${datetimeFields}
      FROM store_datetime 
      WHERE document_version_id = ${documentVersionId} ${localeCondition}

      UNION ALL

      -- JSON fields (41 columns total - SAME ORDER)
      SELECT 
       ${jsonFields}
      FROM store_json 
      WHERE document_version_id = ${documentVersionId} ${localeCondition}

      UNION ALL

      -- Relation fields (41 columns total - SAME ORDER)
      SELECT 
        ${relationFields}
      FROM store_relation 
      WHERE document_version_id = ${documentVersionId} ${localeCondition}

      UNION ALL

      -- File fields (41 columns total - SAME ORDER)
      SELECT 
        ${fileFields}
      FROM store_file 
      WHERE document_version_id = ${documentVersionId} ${localeCondition}

      ORDER BY field_path, locale
    `;

    const { rows }: { rows: Record<string, unknown>[] } = await this.db.execute(query);
    return rows as unknown as UnionRowValue[];
  }

  /**
   * Gets field values for multiple versions in a single query
   */
  private async getAllFieldValuesForMultipleVersions(
    documentVersionIds: string[],
    locale = 'all'
  ): Promise<UnionRowValue[]> {
    if (documentVersionIds.length === 0) return [];

    const localeCondition = locale === 'all'
      ? sql``
      : sql`AND (locale = ${locale} OR locale = 'all')`;

    const documentCondition = sql`document_version_id = ANY(ARRAY[${sql.join(documentVersionIds.map(id => sql`${id}::uuid`), sql`, `)}])`;

    // Use the same UNION ALL query but with IN clause for multiple versions
    const query = sql`
      -- Text fields (41 columns total)
      SELECT 
         ${textFields}
      FROM store_text 
      WHERE ${documentCondition} ${localeCondition}

      UNION ALL

      -- Numeric fields (41 columns total - SAME ORDER)
      SELECT 
         ${numericFields}
      FROM store_numeric 
      WHERE ${documentCondition} ${localeCondition}

      UNION ALL

      -- Boolean fields (41 columns total - SAME ORDER)
      SELECT 
        ${booleanFields}
      FROM store_boolean 
      WHERE ${documentCondition} ${localeCondition}

      UNION ALL

      -- DateTime fields (41 columns total - SAME ORDER)
      SELECT 
        ${datetimeFields}
      FROM store_datetime 
      WHERE ${documentCondition} ${localeCondition}

      UNION ALL

     -- JSON fields (41 columns total - SAME ORDER)
      SELECT 
        ${jsonFields}
      FROM store_json 
      WHERE ${documentCondition} ${localeCondition}

      UNION ALL

      -- Relation fields (41 columns total - SAME ORDER)
      SELECT 
        ${relationFields}
      FROM store_relation 
      WHERE ${documentCondition} ${localeCondition}

      UNION ALL

      -- File fields (41 columns total - SAME ORDER)
      SELECT 
        ${fileFields}
      FROM store_file 
      WHERE ${documentCondition} ${localeCondition}

      ORDER BY document_version_id, field_path, locale
    `;

    const { rows }: { rows: Record<string, unknown>[] } = await this.db.execute(query);
    return rows as unknown as UnionRowValue[];
  }

  /**
   * Converts a union field row - back into an array of FlattenedStore
   * that the reconstruction utilities expect
   */
  private convertUnionRowToFlattenedStores(
    unionRowValues: UnionRowValue[]
  ): FlattenedStore[] {
    return unionRowValues.map(row => {
      const baseValue = {
        field_path: row.field_path,
        field_name: row.field_name,
        locale: row.locale,
        parent_path: row.parent_path ?? undefined,
      };

      switch (row.field_type) {
        case 'text':
          return {
            ...baseValue,
            field_type: 'text' as const,
            value: row.text_value,
          };

        case 'richText':
          return {
            ...baseValue,
            field_type: 'richText' as const,
            value: row.json_value,
          };

        case 'numeric':
          return {
            ...baseValue,
            field_type: row.number_type as 'float' | 'integer' | 'decimal',
            number_type: row.number_type,
            value_integer: row.value_integer,
            value_decimal: row.value_decimal,
            value_float: row.value_float,
          };

        case 'boolean':
          return {
            ...baseValue,
            field_type: 'boolean' as const,
            value: row.boolean_value,
          };

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
          };

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
          };

        case 'relation':
          return {
            ...baseValue,
            field_type: 'relation' as const,
            target_document_id: row.target_document_id,
            target_collection_id: row.target_collection_id,
            relationship_type: row.relationship_type,
            cascade_delete: row.cascade_delete,
          };

        default:
          throw new Error(`Unknown field type: ${row.field_type}`);
      }
    }) as FlattenedStore[];
  }
}

/**
 * Factory function
 * @param siteConfig 
 * @param db 
 * @returns 
 */
export function createQueryBuilders(db: DatabaseConnection) {
  return {
    collections: new CollectionQueries(db),
    documents: new DocumentQueries(db),
  };
}