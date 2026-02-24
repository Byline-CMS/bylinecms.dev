/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  BlockField,
  CollectionDefinition,
  Field,
  ICollectionCommands,
  IDocumentCommands,
} from '@byline/core'
import { isFileStore, isJsonStore, isNumericStore, isRelationStore } from '@byline/core'
import { and, eq, ne } from 'drizzle-orm'
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
import { flattenFields, getFirstOrThrow } from './storage-utils.js'
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

  function isBlockField(field: Field): field is BlockField {
    return field.type === 'block'
  }

  function traverse(fields: Field[], data: any, basePath = '') {
    for (const fieldConfig of fields) {
      const currentPath = basePath ? `${basePath}.${fieldConfig.name}` : fieldConfig.name
      const value = data?.[fieldConfig.name]

      if (value == null) continue

      if (fieldConfig.type === 'block' && Array.isArray(value)) {
        value.forEach((item: any, index: number) => {
          if (item && typeof item === 'object') {
            let blockName: string | undefined
            let blockFieldsData: any

            // Handle new block shape: { type: 'block', name: '...', fields: [...] }
            if (item.type === 'block' && typeof item.name === 'string') {
              blockName = item.name
              blockFieldsData = item.fields
            } else {
              // Legacy shape: { richTextBlock: [...] }
              blockName = Object.keys(item)[0]
              if (blockName) {
                blockFieldsData = item[blockName]
              }
            }

            if (!blockName) return

            const blockPath = `${currentPath}.${index}.${blockName}`
            let itemId = existingByPath.get(`block:${blockPath}`)

            if (item.id) {
              itemId = item.id
            }

            if (!itemId) {
              // Check if we already assigned one in this transaction (unlikely for flat list)
              itemId = existingByPath.get(`block:${blockPath}`)
            }

            if (!itemId) {
              itemId = uuidv7()
            }

            // Always write to metaStore for the new version
            metaInserts.push({
              id: uuidv7(),
              document_version_id: documentVersionId,
              collection_id: collectionId,
              type: 'block',
              path: blockPath,
              item_id: itemId,
              meta: item.meta ?? null, // Preserve other meta if present
            })

            const subFieldConfig = fieldConfig.fields?.find(
              (f): f is BlockField => f.name === blockName && isBlockField(f as Field)
            )

            // Recursion logic (best effort fix for now, focusing on top-level blocks)
            if (subFieldConfig && Array.isArray(blockFieldsData)) {
              const syntheticData: any = {}
              blockFieldsData.forEach((f: any) => {
                if (f && typeof f === 'object') {
                  Object.assign(syntheticData, f)
                }
              })

              traverse(subFieldConfig.fields, syntheticData, `${currentPath}.${index}`)
            }
          }
        })
      } else if (fieldConfig.type === 'array' && Array.isArray(value)) {
        value.forEach((item: any, index: number) => {
          const arrayElementPath = `${currentPath}.${index}`

          // Handle new block shape inside array
          if (
            item &&
            typeof item === 'object' &&
            item.type === 'block' &&
            typeof item.name === 'string'
          ) {
            const blockName = item.name
            const blockPath = `${arrayElementPath}.${blockName}`

            // Generate/Retrieve ID
            let itemId = item.id
            if (!itemId) itemId = existingByPath.get(`block:${blockPath}`)
            if (!itemId) itemId = uuidv7()

            metaInserts.push({
              id: uuidv7(),
              document_version_id: documentVersionId,
              collection_id: collectionId,
              type: 'block',
              path: blockPath,
              item_id: itemId,
              meta: item.meta ?? null,
            })

            // Recurse for fields inside the block
            const subField = fieldConfig.fields?.find((f) => f.name === blockName)
            if (subField && subField.type === 'block' && Array.isArray(item.fields)) {
              const syntheticData: any = {}
              item.fields.forEach((f: any) => {
                if (f && typeof f === 'object') {
                  Object.assign(syntheticData, f)
                }
              })
              // subField is the block definition (e.g. richTextBlock).
              // Its fields are e.g. richText.
              // traverse expects data to contain richText.
              traverse(subField.fields as Field[], syntheticData, blockPath)
            }
          } else if (typeof item === 'object' && item !== null) {
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
              const fieldName = Object.keys(item).filter((k) => k !== '_id')[0]
              if (fieldName != null) {
                const fieldValue = item[fieldName]
                const subField = fieldConfig.fields.find((f) => f.name === fieldName)
                if (subField) {
                  traverse([subField], { [fieldName]: fieldValue }, arrayElementPath)
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
      const flattenedFields = flattenFields(
        params.documentData,
        params.collectionConfig,
        params.locale ?? 'all'
      )

      // 3. Batch-insert all field values, grouped by store type
      const storeBuckets = this.groupFieldValuesByStore(
        flattenedFields,
        documentVersion.id,
        params.collectionId
      )

      for (const [store, rows] of storeBuckets) {
        if (rows.length === 0) continue
        switch (store) {
          case 'text':
            await tx.insert(textStore).values(rows)
            break
          case 'numeric':
            await tx.insert(numericStore).values(rows)
            break
          case 'boolean':
            await tx.insert(booleanStore).values(rows)
            break
          case 'datetime':
            await tx.insert(datetimeStore).values(rows)
            break
          case 'file':
            await tx.insert(fileStore).values(rows)
            break
          case 'relation':
            await tx.insert(relationStore).values(rows)
            break
          case 'json':
            await tx.insert(jsonStore).values(rows)
            break
        }
      }

      // 4. Write meta data (durable IDs for blocks and array items)
      await writeDocumentMeta({
        tx,
        documentVersionId: documentVersion.id,
        collectionId: params.collectionId,
        collectionConfig: params.collectionConfig,
        documentData: params.documentData,
      })

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

  /**
   * groupFieldValuesByStore
   *
   * Groups flattened field values into per-store-type buckets so they can be
   * batch-inserted with a single multi-row INSERT per store.
   */
  private groupFieldValuesByStore(
    flattenedFields: any[],
    documentVersionId: string,
    collectionId: string
  ): Map<string, any[]> {
    const buckets = new Map<string, any[]>([
      ['text', []],
      ['numeric', []],
      ['boolean', []],
      ['datetime', []],
      ['file', []],
      ['relation', []],
      ['json', []],
    ])

    for (const fieldValue of flattenedFields) {
      const baseData = {
        id: uuidv7(),
        document_version_id: documentVersionId,
        collection_id: collectionId,
        field_path: fieldValue.field_path,
        field_name: fieldValue.field_name,
        locale: fieldValue.locale,
        parent_path: fieldValue.parent_path,
      }

      switch (fieldValue.field_type) {
        case 'select':
        case 'text':
        case 'textArea':
          if (typeof fieldValue.value === 'object' && fieldValue.value != null) {
            const entries = Object.entries<string>(fieldValue.value)
            for (const [locale, localizedValue] of entries) {
              buckets.get('text')?.push({
                ...baseData,
                id: uuidv7(),
                locale,
                value: localizedValue,
              })
            }
          } else {
            buckets.get('text')?.push({ ...baseData, value: fieldValue.value as string })
          }
          break

        case 'float':
        case 'integer':
        case 'decimal':
          if (isNumericStore(fieldValue)) {
            buckets.get('numeric')?.push({
              ...baseData,
              number_type: fieldValue.number_type,
              value_float: fieldValue.value_float,
              value_integer: fieldValue.value_integer,
              value_decimal: fieldValue.value_decimal,
            })
          } else {
            throw new Error(`Invalid numeric field value for ${baseData.field_path}`)
          }
          break

        case 'checkbox':
        case 'boolean':
          buckets.get('boolean')?.push({ ...baseData, value: fieldValue.value })
          break

        case 'time':
        case 'date':
        case 'datetime':
          buckets.get('datetime')?.push({
            ...baseData,
            date_type: fieldValue.date_type || 'datetime',
            value_time: fieldValue.value_time,
            value_date: fieldValue.value_date,
            value_timestamp_tz: fieldValue.value_timestamp_tz,
          })
          break

        case 'file':
        case 'image':
          if (isFileStore(fieldValue)) {
            buckets.get('file')?.push({
              ...baseData,
              file_id: fieldValue.file_id,
              filename: fieldValue.filename,
              original_filename: fieldValue.original_filename,
              mime_type: fieldValue.mime_type,
              file_size: fieldValue.file_size,
              storage_provider: fieldValue.storage_provider,
              storage_path: fieldValue.storage_path,
              storage_url: fieldValue.storage_url,
              file_hash: fieldValue.file_hash,
              image_width: fieldValue.image_width,
              image_height: fieldValue.image_height,
              image_format: fieldValue.image_format,
              processing_status: fieldValue.processing_status || 'pending',
              thumbnail_generated: fieldValue.thumbnail_generated || false,
            })
          } else {
            throw new Error(`Invalid file field value for ${baseData.field_path}`)
          }
          break

        case 'relation':
          if (isRelationStore(fieldValue)) {
            buckets.get('relation')?.push({
              ...baseData,
              target_document_id: fieldValue.target_document_id,
              target_collection_id: fieldValue.target_collection_id,
              relationship_type: fieldValue.relationship_type || 'reference',
              cascade_delete: fieldValue.cascade_delete || false,
            })
          } else {
            throw new Error(`Invalid relation field value for ${baseData.field_path}`)
          }
          break

        case 'richText':
          buckets.get('json')?.push({ ...baseData, value: fieldValue.value })
          break

        case 'json':
        case 'object':
          if (isJsonStore(fieldValue)) {
            if (typeof fieldValue.value === 'object' && fieldValue.value != null) {
              const entries = Object.entries<string>(fieldValue.value)
              for (const [locale, localizedValue] of entries) {
                buckets.get('json')?.push({
                  ...baseData,
                  id: uuidv7(),
                  locale,
                  value: localizedValue,
                })
              }
            } else {
              buckets.get('json')?.push({
                ...baseData,
                value: fieldValue.value,
                json_schema: fieldValue.json_schema,
                object_keys: fieldValue.object_keys,
              })
            }
          } else {
            throw new Error(`Invalid JSON field value for ${baseData.field_path}`)
          }
          break

        default:
          throw new Error(`Unsupported field type: ${fieldValue.field_type}`)
      }
    }

    return buckets
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
