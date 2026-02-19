/**
 * Byline CMS
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
 */

export type FieldType =
  | 'array'
  | 'group'
  | 'row'
  | 'block'
  | 'text'
  | 'textArea'
  | 'checkbox'
  | 'boolean'
  | 'select'
  | 'richText'
  | 'datetime'
  | 'date'
  | 'time'
  | 'file'
  | 'image'
  | 'float'
  | 'integer'
  | 'decimal'
  | 'relation'
  | 'json'
  | 'object'

// Utility type to identify presentational field types
export type PresentationalFieldType = 'array' | 'group' | 'row' | 'block'

// Utility type to identify value field types
export type ValueFieldType = Exclude<FieldType, PresentationalFieldType>

export interface ValidationRule {
  type: 'min' | 'max' | 'pattern' | 'custom' | 'email' | 'url'
  value: any
  message?: string
}

export interface DefaultValueContext {
  /**
   * The current document data as it is being built/edited.
   * Defaults may read other field values from here.
   */
  data: Record<string, any>
  /** Current locale (when defaults are locale-aware). */
  locale?: string
  /** Clock access for time-based defaults. */
  now: () => Date
  /** UUID generator for defaults that need stable IDs. */
  uuid?: () => string
}

export type DefaultValue<T = unknown> = T | ((ctx: DefaultValueContext) => T | Promise<T>)

// Base properties that all fields share
interface BaseField {
  name: string
  label?: string
  localized?: boolean
  unique?: boolean
  type: FieldType
  required?: boolean
  helpText?: string
  placeholder?: string
  /**
   * Default value for new documents and inserts.
   * Can be a literal or an (async) function.
   */
  defaultValue?: DefaultValue
}

// Base for presentational fields that contain nested fields
interface BasePresentationalField extends BaseField {
  type: PresentationalFieldType
  fields: Field[]
}

// Base for value-containing fields
interface BaseValueField extends BaseField {
  type: ValueFieldType
}

// Presentational field types
export interface ArrayField extends BasePresentationalField {
  type: 'array'
}

export interface GroupField extends BasePresentationalField {
  type: 'group'
}

export interface RowField extends BasePresentationalField {
  type: 'row'
}

export interface BlockField extends BasePresentationalField {
  type: 'block'
}

// Value field types (preserving existing properties)
export interface TextField extends BaseValueField {
  type: 'text'
  validation?: {
    minLength?: number
    maxLength?: number
    pattern?: string
    rules?: ValidationRule[]
  }
}

export interface TextAreaField extends BaseValueField {
  type: 'textArea'
  validation?: {
    minLength?: number
    maxLength?: number
    pattern?: string
    rules?: ValidationRule[]
  }
}

export interface CheckboxField extends BaseValueField {
  type: 'checkbox'
}

export interface BooleanField extends BaseValueField {
  type: 'boolean'
}

export interface SelectField extends BaseValueField {
  type: 'select'
  options: { label: string; value: string }[]
}

export interface RichTextField extends BaseValueField {
  type: 'richText'
  validation?: {
    minLength?: number
    maxLength?: number
  }
}

export interface TimeField extends BaseValueField {
  type: 'time'
  defaultValue?: DefaultValue<'00:00' | string> // Default to midnight
}

export interface DateField extends BaseValueField {
  type: 'date'
  defaultValue?: DefaultValue<Date>
}

export interface DateTimeField extends BaseValueField {
  type: 'datetime'
  mode?: 'date' | 'datetime'
  yearsInFuture?: number
  yearsInPast?: number
  defaultValue?: DefaultValue<Date>
}

export interface StoredFileValue {
  file_id: string
  filename: string
  original_filename: string
  mime_type: string
  file_size: string
  storage_provider: string
  storage_path: string
  storage_url: string | null
  file_hash: string | null
  image_width: number | null
  image_height: number | null
  image_format: string | null
  processing_status: 'pending' | 'processing' | 'complete' | 'failed'
  thumbnail_generated: boolean
}

export interface FileField extends BaseValueField {
  // Note - same as Image field for now.
  type: 'file'
  // value: StoredFileValue | null // (document value shape / for future helpers)
}

export interface ImageField extends BaseValueField {
  // Note - same as FileField for now.
  type: 'image'
  // value: StoredFileValue | null // (document value shape / for future helpers)
}

export interface FloatField extends BaseValueField {
  type: 'float'
}

export interface IntegerField extends BaseValueField {
  type: 'integer'
}

export interface DecimalField extends BaseValueField {
  type: 'decimal'
}

export interface RelationField extends BaseValueField {
  type: 'relation'
}

export interface JsonField extends BaseValueField {
  type: 'json'
}

export interface ObjectField extends BaseValueField {
  type: 'object'
}

// Union of all presentational fields
export type PresentationalField = ArrayField | GroupField | RowField | BlockField

// Union of all value fields
export type ValueField =
  | TextField
  | TextAreaField
  | CheckboxField
  | BooleanField
  | SelectField
  | RichTextField
  | DateTimeField
  | DateField
  | TimeField
  | FileField
  | ImageField
  | FloatField
  | IntegerField
  | DecimalField
  | RelationField
  | JsonField
  | ObjectField

// Main Field union type
export type Field = PresentationalField | ValueField

// Type guards for field identification
export function isPresentationalField(field: Field): field is PresentationalField {
  return ['array', 'group', 'row', 'block'].includes(field.type)
}

export function isValueField(field: Field): field is ValueField {
  return !isPresentationalField(field)
}

// Utility type to get all nested fields from a field hierarchy
export type NestedFields<T extends Field> = T extends PresentationalField
  ? T['fields'][number] | NestedFields<T['fields'][number]>
  : never
