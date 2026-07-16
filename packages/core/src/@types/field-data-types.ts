/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  ArrayField,
  BlocksField,
  Field,
  FieldSet,
  GroupField,
  LocalizedField,
  OptionalField,
  RelationField,
  SelectField,
} from './field-types.js'
import type { RelatedDocumentValue } from './relation-types.js'
import type { Prettify, ValueUnion } from './type-utils.js'

/**
 * Structural type for any JSON-serializable value. Used as the type for
 * `json` and `richText` field data — these columns are stored as JSON,
 * and the underlying shape is plugin-defined (e.g. Lexical's
 * `SerializedEditorState` for richText). Consumers narrow this at the
 * read site to their plugin's specific state type.
 *
 * Typed as `JsonValue` rather than `unknown` so that values flow cleanly
 * through framework serialization validators (e.g. TanStack Start's
 * `createServerFn`) without being branded as un-serializable.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject

/**
 * A JSON object — the narrower form used by the `object` field type,
 * whose definition constrains values to `Record<string, any>`.
 */
export type JsonObject = { [k: string]: JsonValue }

// The base data type for each field -- group, array, blocks and select are
// handled separately (so the corresponding type here is `never`), but for the
// other leaf field types this is the underlying non-localized JS type.
type BaseFieldDataTypes = {
  array: never
  blocks: never
  boolean: boolean
  checkbox: boolean
  date: Date
  datetime: Date
  decimal: string
  float: number
  group: never
  integer: number
  counter: number
  json: JsonValue
  object: JsonObject
  richText: JsonValue
  select: never
  textArea: string
  code: string
  text: string
  time: string
  relation: RelatedDocumentValue
  file: StoredFileValue
  image: StoredFileValue
}

// -----------------------------------------------------------------------------
//  Field / FieldSet data for a single locale
// -----------------------------------------------------------------------------

// The base data type corresponding to a BlocksField definition, not considering
// the 'optional' modifier.
type BlocksFieldData<T extends BlocksField> = Array<
  Prettify<
    ValueUnion<{
      [K in T['blocks'][number] as K['blockType']]: Prettify<
        {
          _id: string
          _type: K['blockType']
        } & FieldSetData<K['fields']>
      >
    }>
  >
>

type RelationFieldData<T extends RelationField> = T extends { hasMany: true }
  ? RelatedDocumentValue[]
  : RelatedDocumentValue

// The data type corresponding to the given Field definition, without
// considering the 'optional' modifier.
type BaseFieldData<T extends Field> = T extends ArrayField
  ? Array<Prettify<{ _id: string } & FieldSetData<T['fields']>>>
  : T extends BlocksField
    ? Prettify<BlocksFieldData<T>>
    : T extends GroupField
      ? FieldSetData<T['fields']>
      : T extends SelectField
        ? T['options'][number]['value']
        : T extends RelationField
          ? RelationFieldData<T>
          : BaseFieldDataTypes[T['type']]

// The data type corresponding to the given Field definition, taking into
// account the 'optional' modifier.
export type FieldData<T extends Field = Field> = T extends OptionalField
  ? BaseFieldData<T> | undefined
  : BaseFieldData<T>

// The data type corresponding to the given array of fields (i.e. the fields at
// top-level in a collection, or the fields within a group, array item, or
// block).
export type FieldSetData<T extends FieldSet = FieldSet> = Prettify<
  {
    -readonly [F in T[number] as F extends OptionalField ? never : F['name']]: FieldData<F>
  } & {
    -readonly [F in T[number] as F extends OptionalField ? F['name'] : never]?: FieldData<F>
  }
>

// -----------------------------------------------------------------------------
//  Field / FieldSet data for all locales at once
// -----------------------------------------------------------------------------

export type PerLocale<T> = {
  [locale: string]: T
}

type BlocksFieldDataAllLocales<T extends BlocksField> = Array<
  Prettify<
    ValueUnion<{
      [K in T['blocks'][number] as K['blockType']]: {
        _id: string
        _type: K['blockType']
      } & FieldSetDataAllLocales<K['fields']>
    }>
  >
>

type BaseFieldDataAllLocales<T extends Field> = T extends ArrayField
  ? Array<Prettify<{ _id: string } & FieldSetDataAllLocales<T['fields']>>>
  : T extends BlocksField
    ? Prettify<BlocksFieldDataAllLocales<T>>
    : T extends GroupField
      ? FieldSetDataAllLocales<T['fields']>
      : T extends SelectField
        ? T['options'][number]['value']
        : T extends RelationField
          ? RelationFieldData<T>
          : BaseFieldDataTypes[T['type']]

type LocalizedFieldDataAllLocales<T extends Field> = T extends LocalizedField
  ? PerLocale<BaseFieldDataAllLocales<T>>
  : BaseFieldDataAllLocales<T>

export type FieldDataAllLocales<T extends Field = Field> = T extends OptionalField
  ? LocalizedFieldDataAllLocales<T> | undefined
  : LocalizedFieldDataAllLocales<T>

export type FieldSetDataAllLocales<T extends FieldSet = FieldSet> = Prettify<
  {
    -readonly [F in T[number] as F extends OptionalField
      ? never
      : F['name']]: FieldDataAllLocales<F>
  } & {
    -readonly [F in T[number] as F extends OptionalField
      ? F['name']
      : never]?: FieldDataAllLocales<F>
  }
>

// ---------------------------------------------------------------------------
// Data types for file fields
// ---------------------------------------------------------------------------

/**
 * One generated image variant persisted alongside the original file.
 *
 * Populated by the upload service after Sharp produces a derivative —
 * the storage path is always present, the URL is captured at the
 * upload moment via `storage.getUrl()`, and the resolved dimensions /
 * output format are recorded so the read side can build a
 * `<picture>` / `srcset` without a second round-trip.
 */
export interface PersistedVariant {
  /** Variant name from `UploadConfig.sizes[].name`, e.g. `'thumbnail'`, `'card'`. */
  name: string
  storagePath: string
  storageUrl?: string
  width?: number
  height?: number
  /** Output format the variant was written as — `'webp'`, `'avif'`, etc. */
  format?: string
}

export interface StoredFileValue {
  fileId: string
  filename: string
  originalFilename: string
  mimeType: string
  fileSize: number
  storageProvider: string
  storagePath: string
  storageUrl?: string
  fileHash?: string
  imageWidth?: number
  imageHeight?: number
  imageFormat?: string
  processingStatus: 'pending' | 'processing' | 'complete' | 'failed'
  thumbnailGenerated?: boolean
  /**
   * Image variants generated by the upload pipeline. Empty / absent for
   * non-image uploads, for image fields with no `sizes` declared, or
   * for bypass MIME types (SVG, GIF). The read side reads this directly
   * — no special-casing in the EAV restore path.
   */
  variants?: PersistedVariant[]
}

/**
 * A placeholder StoredFileValue used when an image/file is selected but not yet
 * uploaded. This allows the form to hold the file's preview URL while deferring
 * the actual upload until Save.
 */
export interface PendingStoredFileValue {
  fileId: string
  filename: string
  originalFilename: string
  mimeType: string
  fileSize: number
  storageProvider: 'pending'
  storagePath: ''
  storageUrl: string // blob URL for local preview
  fileHash: null
  imageWidth: number | null
  imageHeight: number | null
  imageFormat: null
  processingStatus: 'pending'
  thumbnailGenerated: false
}

/**
 * Type guard to check if a StoredFileValue represents a pending (not yet uploaded) file.
 */
export function isPendingStoredFileValue(value: unknown): value is PendingStoredFileValue {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<StoredFileValue>
  return v.storageProvider === 'pending'
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
    fileId: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    filename: file.name,
    originalFilename: file.name,
    mimeType: file.type,
    fileSize: file.size,
    storageProvider: 'pending',
    storagePath: '',
    storageUrl: previewUrl,
    fileHash: null,
    imageWidth: dimensions?.width ?? null,
    imageHeight: dimensions?.height ?? null,
    imageFormat: null,
    processingStatus: 'pending',
    thumbnailGenerated: false,
  }
}
