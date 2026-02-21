/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

export interface BaseStore {
  field_path: string
  field_name: string
  locale: string
  parent_path?: string
}

export interface TextStore extends BaseStore {
  field_type: 'text' | 'select' | 'textArea'
  value: string // Should only be string after flattening
}

export interface NumericStore extends BaseStore {
  field_type: 'float' | 'integer' | 'decimal'
  number_type: 'float' | 'integer' | 'decimal' // For reconstruction
  value_float?: number
  value_integer?: number
  value_decimal?: string
}

export interface BooleanStore extends BaseStore {
  field_type: 'boolean' | 'checkbox'
  value: boolean
}

export interface DateTimeStore extends BaseStore {
  field_type: 'datetime' | 'date' | 'time'
  date_type: 'datetime' | 'date' | 'time'
  value_time?: string
  value_date?: Date
  value_timestamp_tz?: Date
}

export interface FileStore extends BaseStore {
  field_type: 'file' | 'image'
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

export interface RelationStore extends BaseStore {
  field_type: 'relation'
  target_document_id: string
  target_collection_id: string
  relationship_type?: string
  cascade_delete?: boolean
}

export interface RichTextStore extends BaseStore {
  field_type: 'richText'
  value: any // JSON content
}

export interface JsonStore extends BaseStore {
  field_type: 'json' | 'object'
  value: any
  json_schema?: string
  object_keys?: string[]
}

// Discriminated union of all field value types
export type FlattenedStore =
  | TextStore
  | RichTextStore
  | NumericStore
  | BooleanStore
  | DateTimeStore
  | FileStore
  | RelationStore
  | JsonStore

// Type guards for runtime checking
export function isFileStore(fieldValue: FlattenedStore): fieldValue is FileStore {
  return fieldValue.field_type === 'file' || fieldValue.field_type === 'image'
}

export function isRelationStore(fieldValue: FlattenedStore): fieldValue is RelationStore {
  return fieldValue.field_type === 'relation'
}

export function isJsonStore(fieldValue: FlattenedStore): fieldValue is JsonStore {
  return fieldValue.field_type === 'json' || fieldValue.field_type === 'object'
}

export function isNumericStore(fieldValue: FlattenedStore): fieldValue is NumericStore {
  return ['float', 'integer', 'decimal'].includes(fieldValue.field_type)
}

export function isDateTimeStore(fieldValue: FlattenedStore): fieldValue is DateTimeStore {
  return ['datetime', 'date', 'time'].includes(fieldValue.field_type)
}

// Standardized field value structure for unified processing
export interface UnionRowValue {
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
}
