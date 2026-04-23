/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition, ICollectionCommands, IDocumentCommands } from '@byline/core'
import { and, eq, ne, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { v7 as uuidv7 } from 'uuid'

import {
  booleanStore,
  collections,
  datetimeStore,
  documents,
  documentVersions,
  fileStore,
  jsonStore,
  metaStore,
  numericStore,
  relationStore,
  textStore,
} from '../database/schema/index.js'
import { flattenFieldSetData } from './storage-flatten.js'
import { prepareFieldInsertBuckets } from './storage-insert.js'
import { getFirstOrThrow } from './storage-utils.js'
import type * as schema from '../database/schema/index.js'

type DatabaseConnection = NodePgDatabase<typeof schema>

/**
 * CollectionCommands
 */
export class CollectionCommands implements ICollectionCommands {
  constructor(private db: DatabaseConnection) {}

  async create(
    path: string,
    config: CollectionDefinition,
    opts?: { version?: number; schemaHash?: string }
  ) {
    return await this.db
      .insert(collections)
      .values({
        id: uuidv7(),
        path,
        singular: config.labels.singular || path, // Default to path if singular not provided
        plural: config.labels.plural || `${path}s`, // Default to pluralized path if not
        config,
        ...(opts?.version !== undefined ? { version: opts.version } : {}),
        ...(opts?.schemaHash !== undefined ? { schema_hash: opts.schemaHash } : {}),
      })
      .returning()
  }

  async update(
    id: string,
    patch: {
      config?: CollectionDefinition
      version?: number
      schemaHash?: string
    }
  ) {
    const set: Record<string, unknown> = { updated_at: new Date() }
    if (patch.config !== undefined) set.config = patch.config
    if (patch.version !== undefined) set.version = patch.version
    if (patch.schemaHash !== undefined) set.schema_hash = patch.schemaHash
    return await this.db.update(collections).set(set).where(eq(collections.id, id)).returning()
  }

  async delete(id: string) {
    return await this.db.delete(collections).where(eq(collections.id, id))
  }
}

/**
 * DocumentCommands
 */
export class DocumentCommands implements IDocumentCommands {
  constructor(private db: DatabaseConnection) {}

  /**
   * createDocumentVersion
   *
   * Creates a new document or a new version of an existing document.
   *
   * @param params - Options for creating the document
   * @returns The created document and the number of field values inserted
   */
  async createDocumentVersion(params: {
    documentId?: string // Optional logical document ID when creating a new version for the same logical document
    collectionId: string
    collectionVersion: number
    collectionConfig: CollectionDefinition
    action: string
    documentData: any
    path: string
    locale?: string
    status?: string
    createdBy?: string
    previousVersionId?: string
  }) {
    return await this.db.transaction(async (tx) => {
      let documentId = params.documentId

      // 1. Create the main document if needed
      if (documentId == null) {
        documentId = uuidv7()
        const _document = await tx
          .insert(documents)
          .values({
            id: documentId,
            collection_id: params.collectionId,
          })
          .returning()
          .then(getFirstOrThrow('Failed to create document'))
      }

      // 2. Create the document version
      const documentVersion = await tx
        .insert(documentVersions)
        .values({
          id: uuidv7(), // Document version id
          document_id: documentId,
          collection_id: params.collectionId,
          collection_version: params.collectionVersion,
          path: params.path,
          event_type: params.action ?? 'create',
          status: params.status ?? 'draft',
        })
        .returning()
        .then(getFirstOrThrow('Failed to create document version'))

      // 3. Flatten the document data to field values
      const flattenedFields = flattenFieldSetData(
        params.collectionConfig.fields,
        params.documentData,
        params.locale ?? 'all'
      )

      // 4. Batch-insert all field values, grouped by store type
      const storeBuckets = prepareFieldInsertBuckets(
        flattenedFields,
        documentVersion.id,
        params.collectionId
      )

      if (storeBuckets.text.length > 0) {
        await tx.insert(textStore).values(storeBuckets.text)
      }

      if (storeBuckets.numeric.length > 0) {
        await tx.insert(numericStore).values(storeBuckets.numeric)
      }

      if (storeBuckets.boolean.length > 0) {
        await tx.insert(booleanStore).values(storeBuckets.boolean)
      }

      if (storeBuckets.datetime.length > 0) {
        await tx.insert(datetimeStore).values(storeBuckets.datetime)
      }

      if (storeBuckets.file.length > 0) {
        await tx.insert(fileStore).values(storeBuckets.file)
      }

      if (storeBuckets.relation.length > 0) {
        await tx.insert(relationStore).values(storeBuckets.relation)
      }

      if (storeBuckets.json.length > 0) {
        await tx.insert(jsonStore).values(storeBuckets.json)
      }

      if (storeBuckets.meta.length > 0) {
        await tx.insert(metaStore).values(storeBuckets.meta)
      }

      // 5. Copy field-value rows for other locales from the previous version.
      // When saving in a specific locale (e.g. 'fr'), only rows for that locale
      // and locale='all' are written above. Any existing rows for other locales
      // (e.g. 'en', 'es') from the previous version must be carried forward so
      // per-locale content is not lost under immutable versioning.
      //
      // Each store table is copied in a separate execute() call because
      // node-postgres does not support multiple statements in a single
      // parameterised query. All calls share the same transaction.
      if (params.previousVersionId && params.locale && params.locale !== 'all') {
        const prevId = params.previousVersionId
        const newId = documentVersion.id
        const activeLoc = params.locale

        await tx.execute(sql`
          INSERT INTO byline_store_text
            (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, value, word_count, created_at, updated_at)
          SELECT gen_random_uuid(), ${newId}::uuid, collection_id, field_path, field_name, locale, parent_path, value, word_count, NOW(), NOW()
          FROM byline_store_text
          WHERE document_version_id = ${prevId}::uuid
            AND locale NOT IN ('all', ${activeLoc})
          ON CONFLICT (document_version_id, field_path, locale) DO NOTHING
        `)

        await tx.execute(sql`
          INSERT INTO byline_store_numeric
            (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, number_type, value_integer, value_decimal, value_float, created_at, updated_at)
          SELECT gen_random_uuid(), ${newId}::uuid, collection_id, field_path, field_name, locale, parent_path, number_type, value_integer, value_decimal, value_float, NOW(), NOW()
          FROM byline_store_numeric
          WHERE document_version_id = ${prevId}::uuid
            AND locale NOT IN ('all', ${activeLoc})
          ON CONFLICT (document_version_id, field_path, locale) DO NOTHING
        `)

        await tx.execute(sql`
          INSERT INTO byline_store_boolean
            (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, value, created_at, updated_at)
          SELECT gen_random_uuid(), ${newId}::uuid, collection_id, field_path, field_name, locale, parent_path, value, NOW(), NOW()
          FROM byline_store_boolean
          WHERE document_version_id = ${prevId}::uuid
            AND locale NOT IN ('all', ${activeLoc})
          ON CONFLICT (document_version_id, field_path, locale) DO NOTHING
        `)

        await tx.execute(sql`
          INSERT INTO byline_store_datetime
            (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, date_type, value_date, value_time, value_timestamp_tz, created_at, updated_at)
          SELECT gen_random_uuid(), ${newId}::uuid, collection_id, field_path, field_name, locale, parent_path, date_type, value_date, value_time, value_timestamp_tz, NOW(), NOW()
          FROM byline_store_datetime
          WHERE document_version_id = ${prevId}::uuid
            AND locale NOT IN ('all', ${activeLoc})
          ON CONFLICT (document_version_id, field_path, locale) DO NOTHING
        `)

        await tx.execute(sql`
          INSERT INTO byline_store_json
            (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, value, json_schema, object_keys, created_at, updated_at)
          SELECT gen_random_uuid(), ${newId}::uuid, collection_id, field_path, field_name, locale, parent_path, value, json_schema, object_keys, NOW(), NOW()
          FROM byline_store_json
          WHERE document_version_id = ${prevId}::uuid
            AND locale NOT IN ('all', ${activeLoc})
          ON CONFLICT (document_version_id, field_path, locale) DO NOTHING
        `)

        await tx.execute(sql`
          INSERT INTO byline_store_relation
            (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, target_document_id, target_collection_id, relationship_type, cascade_delete, created_at, updated_at)
          SELECT gen_random_uuid(), ${newId}::uuid, collection_id, field_path, field_name, locale, parent_path, target_document_id, target_collection_id, relationship_type, cascade_delete, NOW(), NOW()
          FROM byline_store_relation
          WHERE document_version_id = ${prevId}::uuid
            AND locale NOT IN ('all', ${activeLoc})
          ON CONFLICT (document_version_id, field_path, locale) DO NOTHING
        `)

        await tx.execute(sql`
          INSERT INTO byline_store_file
            (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, file_id, filename, original_filename, mime_type, file_size, file_hash, storage_provider, storage_path, storage_url, image_width, image_height, image_format, processing_status, thumbnail_generated, created_at, updated_at)
          SELECT gen_random_uuid(), ${newId}::uuid, collection_id, field_path, field_name, locale, parent_path, file_id, filename, original_filename, mime_type, file_size, file_hash, storage_provider, storage_path, storage_url, image_width, image_height, image_format, processing_status, thumbnail_generated, NOW(), NOW()
          FROM byline_store_file
          WHERE document_version_id = ${prevId}::uuid
            AND locale NOT IN ('all', ${activeLoc})
          ON CONFLICT (document_version_id, field_path, locale) DO NOTHING
        `)
      }

      return {
        document: documentVersion,
        fieldCount: flattenedFields.length,
      }
    })
  }

  /**
   * setDocumentStatus
   *
   * Mutate the status field on an existing document version row.
   * This is the one case where we UPDATE a version in-place — status is
   * lifecycle metadata, not content.
   */
  async setDocumentStatus(params: { document_version_id: string; status: string }): Promise<void> {
    await this.db
      .update(documentVersions)
      .set({
        status: params.status,
        updated_at: new Date(),
      })
      .where(eq(documentVersions.id, params.document_version_id))
  }

  /**
   * archivePublishedVersions
   *
   * Set ALL versions of a document that currently have `currentStatus`
   * (defaults to 'published') to 'archived'. Optionally exclude a specific
   * version so the caller can protect the version it is about to publish.
   *
   * Returns the number of rows updated.
   */
  async archivePublishedVersions(params: {
    document_id: string
    currentStatus?: string
    excludeVersionId?: string
  }): Promise<number> {
    const targetStatus = params.currentStatus ?? 'published'
    const conditions = [
      eq(documentVersions.document_id, params.document_id),
      eq(documentVersions.status, targetStatus),
    ]
    if (params.excludeVersionId) {
      conditions.push(ne(documentVersions.id, params.excludeVersionId))
    }
    const result = await this.db
      .update(documentVersions)
      .set({ status: 'archived', updated_at: new Date() })
      .where(and(...conditions))
    return (result as any).rowCount ?? 0
  }

  /**
   * softDeleteDocument
   *
   * Mark ALL versions of a document as deleted by setting `is_deleted = true`.
   * The `current_documents` view filters these out, so the document disappears
   * from listings without physically removing data.
   *
   * Returns the number of version rows marked as deleted.
   */
  async softDeleteDocument(params: { document_id: string }): Promise<number> {
    const result = await this.db
      .update(documentVersions)
      .set({
        is_deleted: true,
        updated_at: new Date(),
      })
      .where(eq(documentVersions.document_id, params.document_id))
    return (result as any).rowCount ?? 0
  }
}

export function createCommandBuilders(db: DatabaseConnection) {
  return {
    collections: new CollectionCommands(db),
    documents: new DocumentCommands(db),
  }
}
