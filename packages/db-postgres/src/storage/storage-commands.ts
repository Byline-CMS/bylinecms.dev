/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  BlocksField,
  CollectionDefinition,
  Field,
  ICollectionCommands,
  IDocumentCommands,
} from '@byline/core'
import { isFileStore, isJsonStore, isNumericStore, isRelationStore } from '@byline/core'
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
import { flattenFieldSetData, groupAndNormalizeFlattenedFields } from './new-storage-utils.js'
import { getFirstOrThrow } from './storage-utils.js'
import type * as schema from '../database/schema/index.js'

type DatabaseConnection = NodePgDatabase<typeof schema>

interface WriteDocumentMetaParams {
  tx: DatabaseConnection
  documentVersionId: string
  collectionId: string
  collectionConfig: CollectionDefinition
  documentData: any
}

async function writeDocumentMeta({
  tx,
  documentVersionId,
  collectionId,
  collectionConfig,
  documentData,
}: WriteDocumentMetaParams) {
  const existingMeta = await tx
    .select({ type: metaStore.type, path: metaStore.path, item_id: metaStore.item_id })
    .from(metaStore)
    .where(eq(metaStore.document_version_id, documentVersionId))

  const existingByPath = new Map<string, string>()
  for (const row of existingMeta) {
    existingByPath.set(`${row.type}:${row.path}`, row.item_id)
  }

  const metaInserts: {
    id: string
    document_version_id: string
    collection_id: string
    type: string
    path: string
    item_id: string
    meta: unknown
  }[] = []

  function traverse(fields: Field[], data: any, basePath = '') {
    for (const fieldConfig of fields) {
      const currentPath = basePath ? `${basePath}.${fieldConfig.name}` : fieldConfig.name
      const value = data?.[fieldConfig.name]

      if (value == null) continue

      if (fieldConfig.type === 'blocks' && Array.isArray(value)) {
        const blocksField = fieldConfig as BlocksField
        value.forEach((item: any, index: number) => {
          if (item && typeof item === 'object' && typeof item._type === 'string') {
            const blockName = item._type
            const blockPath = `${currentPath}.${index}.${blockName}`

            // Resolve or generate stable identity
            let itemId = item._id
            if (!itemId) itemId = existingByPath.get(`group:${blockPath}`)
            if (!itemId) itemId = uuidv7()

            metaInserts.push({
              id: uuidv7(),
              document_version_id: documentVersionId,
              collection_id: collectionId,
              type: 'group',
              path: blockPath,
              item_id: itemId,
              meta: null,
            })

            const blockConfig = blocksField.blocks?.find((b) => b.blockType === blockName)

            // Recurse into block child fields
            if (blockConfig) {
              const { _id, _type, ...fieldData } = item
              traverse(blockConfig.fields, fieldData, `${currentPath}.${index}`)
            }
          }
        })
      } else if (fieldConfig.type === 'array' && Array.isArray(value)) {
        value.forEach((item: any, index: number) => {
          const arrayElementPath = `${currentPath}.${index}`

          if (typeof item === 'object' && item !== null) {
            // Non-block array item — assign a stable identity via array_item meta.
            let itemId = item._id
            if (!itemId) itemId = existingByPath.get(`array_item:${arrayElementPath}`)
            if (!itemId) itemId = uuidv7()

            metaInserts.push({
              id: uuidv7(),
              document_version_id: documentVersionId,
              collection_id: collectionId,
              type: 'array_item',
              path: arrayElementPath,
              item_id: itemId,
              meta: null,
            })

            // Recurse into sub-fields for nested structures
            if (fieldConfig.fields) {
              const itemKeys = Object.keys(item).filter((k) => k !== '_id')
              for (const fieldName of itemKeys) {
                const fieldValue = item[fieldName]
                const subField = fieldConfig.fields.find((f) => f.name === fieldName)
                if (subField) {
                  if (
                    (subField.type === 'group' || subField.type === 'array') &&
                    typeof fieldValue === 'object' &&
                    !Array.isArray(fieldValue) &&
                    fieldValue !== null &&
                    Array.isArray(subField.fields)
                  ) {
                    traverse(
                      subField.fields as Field[],
                      fieldValue,
                      `${arrayElementPath}.${fieldName}`
                    )
                  } else {
                    traverse([subField], { [fieldName]: fieldValue }, arrayElementPath)
                  }
                }
              }
            }
          }
        })
      }
    }
  }

  traverse(collectionConfig.fields as Field[], documentData)

  if (metaInserts.length > 0) {
    await tx.insert(metaStore).values(metaInserts)
  }
}

/**
 * CollectionCommands
 */
export class CollectionCommands implements ICollectionCommands {
  constructor(private db: DatabaseConnection) {}

  async create(path: string, config: CollectionDefinition) {
    return await this.db
      .insert(collections)
      .values({
        id: uuidv7(),
        path,
        singular: config.labels.singular || path, // Default to path if singular not provided
        plural: config.labels.plural || `${path}s`, // Default to pluralized path if not
        config,
      })
      .returning()
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
          path: params.path,
          event_type: params.action ?? 'create',
          status: params.status ?? 'draft',
        })
        .returning()
        .then(getFirstOrThrow('Failed to create document version'))

      // 2. Flatten the document data to field values
      const flattenedFields = flattenFieldSetData(
        params.collectionConfig.fields,
        params.documentData,
        params.locale ?? 'all'
      )

      // 3. Batch-insert all field values, grouped by store type
      const storeBuckets = groupAndNormalizeFlattenedFields(
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

      // 3b. Copy field-value rows for other locales from the previous version.
      // When saving in a specific locale (e.g. 'fr'), only rows for that locale
      // and locale='all' are written above. Any existing rows for other locales
      // (e.g. 'en', 'es') from the previous version must be carried forward so
      // per-locale content is not lost under immutable versioning.
      if (params.previousVersionId && params.locale && params.locale !== 'all') {
        const prevId = params.previousVersionId
        const newId = documentVersion.id
        const activeLoc = params.locale

        await tx.execute(sql`
          INSERT INTO store_text
            (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, value, word_count, created_at, updated_at)
          SELECT gen_random_uuid(), ${newId}::uuid, collection_id, field_path, field_name, locale, parent_path, value, word_count, NOW(), NOW()
          FROM store_text
          WHERE document_version_id = ${prevId}::uuid
            AND locale NOT IN ('all', ${activeLoc})
          ON CONFLICT (document_version_id, field_path, locale) DO NOTHING
        `)

        await tx.execute(sql`
          INSERT INTO store_numeric
            (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, number_type, value_integer, value_decimal, value_float, created_at, updated_at)
          SELECT gen_random_uuid(), ${newId}::uuid, collection_id, field_path, field_name, locale, parent_path, number_type, value_integer, value_decimal, value_float, NOW(), NOW()
          FROM store_numeric
          WHERE document_version_id = ${prevId}::uuid
            AND locale NOT IN ('all', ${activeLoc})
          ON CONFLICT (document_version_id, field_path, locale) DO NOTHING
        `)

        await tx.execute(sql`
          INSERT INTO store_boolean
            (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, value, created_at, updated_at)
          SELECT gen_random_uuid(), ${newId}::uuid, collection_id, field_path, field_name, locale, parent_path, value, NOW(), NOW()
          FROM store_boolean
          WHERE document_version_id = ${prevId}::uuid
            AND locale NOT IN ('all', ${activeLoc})
          ON CONFLICT (document_version_id, field_path, locale) DO NOTHING
        `)

        await tx.execute(sql`
          INSERT INTO store_datetime
            (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, date_type, value_date, value_time, value_timestamp_tz, created_at, updated_at)
          SELECT gen_random_uuid(), ${newId}::uuid, collection_id, field_path, field_name, locale, parent_path, date_type, value_date, value_time, value_timestamp_tz, NOW(), NOW()
          FROM store_datetime
          WHERE document_version_id = ${prevId}::uuid
            AND locale NOT IN ('all', ${activeLoc})
          ON CONFLICT (document_version_id, field_path, locale) DO NOTHING
        `)

        await tx.execute(sql`
          INSERT INTO store_json
            (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, value, json_schema, object_keys, created_at, updated_at)
          SELECT gen_random_uuid(), ${newId}::uuid, collection_id, field_path, field_name, locale, parent_path, value, json_schema, object_keys, NOW(), NOW()
          FROM store_json
          WHERE document_version_id = ${prevId}::uuid
            AND locale NOT IN ('all', ${activeLoc})
          ON CONFLICT (document_version_id, field_path, locale) DO NOTHING
        `)

        await tx.execute(sql`
          INSERT INTO store_relation
            (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, target_document_id, target_collection_id, relationship_type, cascade_delete, created_at, updated_at)
          SELECT gen_random_uuid(), ${newId}::uuid, collection_id, field_path, field_name, locale, parent_path, target_document_id, target_collection_id, relationship_type, cascade_delete, NOW(), NOW()
          FROM store_relation
          WHERE document_version_id = ${prevId}::uuid
            AND locale NOT IN ('all', ${activeLoc})
          ON CONFLICT (document_version_id, field_path, locale) DO NOTHING
        `)

        await tx.execute(sql`
          INSERT INTO store_file
            (id, document_version_id, collection_id, field_path, field_name, locale, parent_path, file_id, filename, original_filename, mime_type, file_size, file_hash, storage_provider, storage_path, storage_url, image_width, image_height, image_format, processing_status, thumbnail_generated, created_at, updated_at)
          SELECT gen_random_uuid(), ${newId}::uuid, collection_id, field_path, field_name, locale, parent_path, file_id, filename, original_filename, mime_type, file_size, file_hash, storage_provider, storage_path, storage_url, image_width, image_height, image_format, processing_status, thumbnail_generated, NOW(), NOW()
          FROM store_file
          WHERE document_version_id = ${prevId}::uuid
            AND locale NOT IN ('all', ${activeLoc})
          ON CONFLICT (document_version_id, field_path, locale) DO NOTHING
        `)
      }

      // // 4. Write meta data (durable IDs for blocks and array items)
      // await writeDocumentMeta({
      //   tx,
      //   documentVersionId: documentVersion.id,
      //   collectionId: params.collectionId,
      //   collectionConfig: params.collectionConfig,
      //   documentData: params.documentData,
      // })

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

/**
 * Factory function
 * @param siteConfig
 * @param db
 * @returns
 */
export function createCommandBuilders(db: DatabaseConnection) {
  return {
    collections: new CollectionCommands(db),
    documents: new DocumentCommands(db),
  }
}
