/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
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

// ---------------------------------------------------------------------------
// Field-level hooks (client-side)
// ---------------------------------------------------------------------------

/**
 * Context passed to field-level hooks. Gives the hook access to the changing
 * value, the previous value, the full document data, and the field definition.
 */
export interface FieldHookContext {
  /** The incoming value (after the user edit). */
  value: any
  /** The value before this edit. */
  previousValue: any
  /** Current document data (full form state). */
  data: Record<string, any>
  /** Dot-path of the field inside the document, e.g. `"content.0.richText"`. */
  path: string
  /** The field definition this hook is attached to. */
  field: Field
}

/**
 * Return type of `beforeChange`. Allows the hook to:
 *  - replace the value (`value`),
 *  - reject the change with a per-field error (`error`),
 *  - or do nothing (return `undefined` / `{}`).
 */
export interface FieldBeforeChangeResult {
  /** If set, this value replaces the incoming value. */
  value?: any
  /** If set, the change is blocked and this message is shown as a field error. */
  error?: string
}

/**
 * Hooks that can be attached to any field via the `hooks` property on the
 * field definition. Both hooks are async-capable to support debounced
 * remote validation or similar patterns.
 */
export interface FieldHooks {
  /**
   * Fires **before** the built-in validation rules are evaluated.
   * Returning `{ error }` short-circuits: the value is **not** written and
   * the error is displayed on the field.
   */
  beforeValidate?: (
    ctx: FieldHookContext
  ) => FieldBeforeChangeResult | Promise<FieldBeforeChangeResult> | void | Promise<void>
  /**
   * Fires **after** validation passes but **before** the value is committed
   * to the form store and a patch is emitted.
   * Returning `{ value }` substitutes the committed value (e.g. trim, slug).
   * Returning `{ error }` blocks the change.
   */
  beforeChange?: (
    ctx: FieldHookContext
  ) => FieldBeforeChangeResult | Promise<FieldBeforeChangeResult> | void | Promise<void>
}

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
  /**
   * Optional field-level hooks that run on the client during editing.
   * @see FieldHooks
   */
  hooks?: FieldHooks
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
