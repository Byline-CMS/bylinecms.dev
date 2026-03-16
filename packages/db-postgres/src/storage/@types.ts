/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// Data structures for flattened field data -- these align closely with the
// shapes of the field data tables (textStore, numericStore, etc.), but have a
// more convenient shape for use in the flatten / reconstruct functions.
interface BaseFlattenedFieldData {
  locale: string
  field_path: string[]
}

interface FlattenedTextFieldValue extends BaseFlattenedFieldData {
  field_type: 'text'
  value: string
}

interface FlattenedNumericFieldValue extends BaseFlattenedFieldData {
  field_type: 'numeric'
  number_type: 'integer' | 'float' | 'decimal'
  value_float?: number
  value_integer?: number
  value_decimal?: string
}

interface FlattenedBooleanFieldValue extends BaseFlattenedFieldData {
  field_type: 'boolean'
  value: boolean
}

interface FlattenedDateTimeFieldValue extends BaseFlattenedFieldData {
  field_type: 'datetime'
  date_type: 'datetime' | 'date' | 'time'
  value_time?: string
  value_date?: Date
  value_timestamp_tz?: Date
}

interface FlattenedFileFieldValue extends BaseFlattenedFieldData {
  field_type: 'file'
  file_id: string
  filename: string
  original_filename: string
  mime_type: string
  file_size: number
  storage_provider: string
  storage_path: string
  storage_url?: string
  file_hash?: string
  image_width?: number
  image_height?: number
  image_format?: string
  processing_status?: string
  thumbnail_generated?: boolean
}

interface FlattenedRelationFieldValue extends BaseFlattenedFieldData {
  field_type: 'relation'
  target_document_id: string
  target_collection_id: string
  relationship_type?: string
  cascade_delete?: boolean
}

interface FlattenedJsonFieldValue extends BaseFlattenedFieldData {
  field_type: 'json'
  value: unknown // JSON-serializable data
  // json_schema?: object
  // object_keys?: string[]
}

interface FlattenedMetaFieldValue extends BaseFlattenedFieldData {
  field_type: 'meta'
  type: 'array_item' | 'group'
  item_id: string
  meta?: unknown
}

export type FlattenedFieldValue =
  | FlattenedTextFieldValue
  | FlattenedNumericFieldValue
  | FlattenedBooleanFieldValue
  | FlattenedDateTimeFieldValue
  | FlattenedFileFieldValue
  | FlattenedRelationFieldValue
  | FlattenedJsonFieldValue
  | FlattenedMetaFieldValue

// Standardized field value structure for unified processing
export interface UnifiedFieldValue {
  id: string
  document_version_id: string
  collection_id: string
  field_type: string
  field_path: string
  field_name: string
  locale: string
  parent_path: string | null

  // Value fields - only one will be populated per row
  text_value: string | null
  boolean_value: boolean | null
  json_value: any | null

  // Specialized fields for complex types
  date_type: string | null
  value_date: Date | null
  value_time: string | null
  value_timestamp_tz: Date | null

  // File or Image fields
  file_id: string | null
  filename: string | null
  original_filename: string | null
  mime_type: string | null
  file_size: number | null
  storage_provider: string | null
  storage_path: string | null
  storage_url: string | null
  file_hash: string | null
  image_width: number | null
  image_height: number | null
  image_format: string | null
  processing_status: string | null
  thumbnail_generated: boolean | null

  // Relation fields
  target_document_id: string | null
  target_collection_id: string | null
  relationship_type: string | null
  cascade_delete: boolean | null

  // JSON fields
  json_schema: string | null
  object_keys: string[] | null

  // Numeric field type info
  number_type: string | null
  value_integer: number | null
  value_decimal: string | null
  value_float: number | null

  // Meta fields
  meta_type: string | null
  meta_item_id: string | null
}
