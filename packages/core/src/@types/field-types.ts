/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

export type FieldType =
  | 'array'
  | 'blocks'
  | 'composite'
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

// Utility type to identify structure field types (fields that contain nested fields)
export type StructureFieldType = 'array' | 'blocks' | 'composite'

// Utility type to identify value field types
export type ValueFieldType = Exclude<FieldType, StructureFieldType>

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
  /**
   * `'change'` — fired on every keystroke / field edit.
   * `'submit'` — fired once during form submit, before `validateForm()`.
   *
   * Hooks can use this to vary behaviour, e.g. only auto-populate a
   * derived value at submit time while showing advisory errors on change.
   */
  operation: 'change' | 'submit'
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
 * A single field-hook function signature.
 */
export type FieldHookFn = (
  ctx: FieldHookContext
) => FieldBeforeChangeResult | Promise<FieldBeforeChangeResult> | void | Promise<void>

/**
 * Hooks that can be attached to any field via the `hooks` property on the
 * field definition. Both hooks are async-capable to support debounced
 * remote validation or similar patterns.
 *
 * Each hook accepts a single function or an **array** of functions that
 * are executed in order. Execution stops at the first function that
 * returns `{ error }` (for blocking hooks like `beforeChange`).
 */
export interface FieldHooks {
  /**
   * Fires **before** the built-in validation rules are evaluated.
   *
   * This hook is **advisory**: the value is always committed to the form
   * store regardless of the result. Returning `{ error }` displays a
   * per-field error (useful for live validation feedback) but does **not**
   * block the change — the user can keep typing.
   */
  beforeValidate?: FieldHookFn | FieldHookFn[]
  /**
   * Fires **after** `beforeValidate` but **before** the value is committed
   * to the form store and a patch is emitted.
   *
   * Returning `{ value }` substitutes the committed value (e.g. trim, slug).
   * Returning `{ error }` **blocks** the change — the value is not written.
   *
   * ⚠️  Value transformations will reset the cursor position in text inputs.
   * Prefer `beforeValidate` for feedback that should not interfere with typing.
   */
  beforeChange?: FieldHookFn | FieldHookFn[]
}

/** Normalise a hook slot (single function or array) into a flat array. */
export function normalizeHooks(hook: FieldHookFn | FieldHookFn[] | undefined): FieldHookFn[] {
  if (!hook) return []
  return Array.isArray(hook) ? hook : [hook]
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
  /**
   * Optional submit-time validator. Called by `validateForm()` for every field
   * type — including structure fields (composite, array, blocks).
   *
   * Receives the resolved field value (lodash `get` on the full form store, so
   * composites arrive as their assembled value, e.g. `[{en:true},{fr:false}]`)
   * and the complete form data snapshot.
   *
   * Return a non-empty string to block submission and display the message as a
   * field-level error. Return `undefined` (or nothing) to pass.
   */
  validate?: (value: any, data: Record<string, any>) => string | undefined
}

// Base for structure fields that contain nested fields
interface BaseStructureField extends BaseField {
  type: StructureFieldType
  fields: Field[]
}

// Base for value-containing fields
interface BaseValueField extends BaseField {
  type: ValueFieldType
}

// Structure field types
export interface ArrayField extends BaseStructureField {
  type: 'array'
}

export interface BlocksField extends BaseStructureField {
  type: 'blocks'
  /** The composite field definitions available as block variants in this blocks container. */
  fields: CompositeField[]
}

export interface CompositeField extends BaseStructureField {
  type: 'composite'
}

/**
 * @deprecated Use `CompositeField` instead. Alias kept for migration convenience.
 */
export type BlockField = CompositeField

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

/**
 * A placeholder StoredFileValue used when an image/file is selected but not yet
 * uploaded. This allows the form to hold the file's preview URL while deferring
 * the actual upload until Save.
 */
export interface PendingStoredFileValue {
  file_id: string
  filename: string
  original_filename: string
  mime_type: string
  file_size: string
  storage_provider: 'pending'
  storage_path: ''
  storage_url: string // blob URL for local preview
  file_hash: null
  image_width: number | null
  image_height: number | null
  image_format: null
  processing_status: 'pending'
  thumbnail_generated: false
}

/**
 * Type guard to check if a StoredFileValue represents a pending (not yet uploaded) file.
 */
export function isPendingStoredFileValue(value: unknown): value is PendingStoredFileValue {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<StoredFileValue>
  return v.storage_provider === 'pending'
}

/**
 * Create a pending placeholder value for a file that is selected but not yet uploaded.
 */
export function createPendingStoredFileValue(
  file: File,
  previewUrl: string,
  dimensions?: { width: number; height: number }
): PendingStoredFileValue {
  return {
    file_id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    filename: file.name,
    original_filename: file.name,
    mime_type: file.type,
    file_size: String(file.size),
    storage_provider: 'pending',
    storage_path: '',
    storage_url: previewUrl,
    file_hash: null,
    image_width: dimensions?.width ?? null,
    image_height: dimensions?.height ?? null,
    image_format: null,
    processing_status: 'pending',
    thumbnail_generated: false,
  }
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
  /**
   * The `path` of the target collection (e.g. `'media'`, `'authors'`).
   * The field picker will query this collection when selecting a reference.
   */
  targetCollection: string
  /**
   * Allow multiple references. When `true` the stored value is an array of
   * relation rows. Defaults to `false` (single reference).
   */
  multiple?: boolean
  /**
   * Field name from the target collection to display in the picker and
   * inline summary. Falls back to the first text field if omitted.
   */
  displayField?: string
}

export interface JsonField extends BaseValueField {
  type: 'json'
}

export interface ObjectField extends BaseValueField {
  type: 'object'
}

// Union of all structure fields
export type StructureField = ArrayField | BlocksField | CompositeField

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
export type Field = StructureField | ValueField

// Type guards for field identification
export function isStructureField(field: Field): field is StructureField {
  return ['array', 'blocks', 'composite'].includes(field.type)
}

export function isBlocksField(field: Field): field is BlocksField {
  return field.type === 'blocks'
}

export function isCompositeField(field: Field): field is CompositeField {
  return field.type === 'composite'
}

export function isValueField(field: Field): field is ValueField {
  return !isStructureField(field)
}

// Utility type to get all nested fields from a field hierarchy
export type NestedFields<T extends Field> = T extends StructureField
  ? T['fields'][number] | NestedFields<T['fields'][number]>
  : never
