/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { ERR_DATABASE, getLogger } from '@byline/core'
import { v7 as uuidv7 } from 'uuid'

import type {
  booleanStore,
  datetimeStore,
  fileStore,
  jsonStore,
  metaStore,
  numericStore,
  relationStore,
  textStore,
} from '@/database/schema/index.js'
import type { FlattenedFieldValue } from './@types.js'

// ------------------------------------------------------------------------------
// Insert-bucket preparation: take flattened field values and bucket them by
// target store table, producing Drizzle-typed rows ready for a bulk insert.
// ------------------------------------------------------------------------------

type FieldInsertBuckets = {
  text: (typeof textStore.$inferInsert)[]
  numeric: (typeof numericStore.$inferInsert)[]
  boolean: (typeof booleanStore.$inferInsert)[]
  datetime: (typeof datetimeStore.$inferInsert)[]
  file: (typeof fileStore.$inferInsert)[]
  relation: (typeof relationStore.$inferInsert)[]
  json: (typeof jsonStore.$inferInsert)[]
  meta: (typeof metaStore.$inferInsert)[]
}

export const prepareFieldInsertBuckets = (
  flattenedFields: FlattenedFieldValue[],
  document_version_id: string,
  collection_id: string
): FieldInsertBuckets => {
  const buckets: FieldInsertBuckets = {
    text: [],
    numeric: [],
    boolean: [],
    datetime: [],
    file: [],
    relation: [],
    json: [],
    meta: [],
  }

  for (const field of flattenedFields) {
    const { field_type, field_path, locale } = field

    if (field_type === 'meta') {
      buckets.meta.push({
        id: uuidv7(),
        document_version_id,
        collection_id,
        type: field.type,
        path: field_path.join('.'),
        item_id: field.item_id,
      })
      continue
    }

    const base = {
      id: uuidv7(),
      document_version_id,
      collection_id,
      field_path: field_path.join('.'),
      field_name: field_path[field_path.length - 1] ?? '',
      locale,
      parent_path: field_path.length > 1 ? field_path.slice(0, -1).join('.') : undefined,
    }

    switch (field_type) {
      case 'text':
        buckets.text.push({ ...base, value: field.value })
        continue

      case 'numeric':
        buckets.numeric.push({
          ...base,
          number_type: field.number_type,
          value_float: field.value_float,
          value_integer: field.value_integer,
          value_decimal: field.value_decimal,
        })
        continue

      case 'boolean':
        buckets.boolean.push({
          ...base,
          value: field.value,
        })
        continue

      case 'datetime':
        buckets.datetime.push({
          ...base,
          date_type: field.date_type,
          value_date: field.value_date?.toISOString(), // TODO: Is this the appropriate conversion?
          value_time: field.value_time,
          value_timestamp_tz: field.value_timestamp_tz,
        })
        continue

      case 'file':
        buckets.file.push({
          ...base,
          file_id: field.file_id,
          filename: field.filename,
          original_filename: field.original_filename,
          mime_type: field.mime_type,
          file_size: field.file_size,
          storage_provider: field.storage_provider,
          storage_path: field.storage_path,
          storage_url: field.storage_url,
          file_hash: field.file_hash,
          image_width: field.image_width,
          image_height: field.image_height,
          image_format: field.image_format,
          processing_status: field.processing_status || 'pending', // TODO: Is 'pending' the appropriate default status?
          thumbnail_generated: field.thumbnail_generated || false,
        })
        continue

      case 'relation':
        buckets.relation.push({
          ...base,
          target_document_id: field.target_document_id,
          target_collection_id: field.target_collection_id,
          relationship_type: field.relationship_type || 'reference', // TODO: Is this the appropriate place to set this?
          cascade_delete: field.cascade_delete || false, // TODO: Same question?
        })
        continue

      case 'json':
        buckets.json.push({
          ...base,
          value: field.value,
        })
        continue

      default:
        throw ERR_DATABASE({
          message: `unexpected field type: ${field_type}`,
          details: { fieldType: field_type },
        }).log(getLogger())
    }
  }

  return buckets
}
