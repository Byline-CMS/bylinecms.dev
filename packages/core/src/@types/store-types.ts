/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { UnifiedFieldValue } from '../storage/storage-row-types.js'

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

/**
 * One generated image variant persisted alongside the original file
 * inside `store_file.variants` (jsonb). Mirrors `PersistedVariant` on
 * the field-data side; kept in sync because flatten/restore copies
 * directly between them.
 */
export interface FileStoreVariant {
  name: string
  storage_path: string
  storage_url?: string
  width?: number
  height?: number
  format?: string
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
  /** Image variants persisted as jsonb. Absent for non-image / no-sizes uploads. */
  variants?: FileStoreVariant[]
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

/**
 * @deprecated Use {@link UnifiedFieldValue} from '@byline/core' — same shape;
 * this alias remains for source compatibility.
 */
export type UnionRowValue = UnifiedFieldValue
