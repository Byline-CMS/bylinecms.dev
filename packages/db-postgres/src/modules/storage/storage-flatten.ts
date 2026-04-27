/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  Field,
  FieldSet,
  RelatedDocumentValue,
  StoredFileValue,
  ValueField,
} from '@byline/core'
import { ERR_DATABASE, getLogger } from '@byline/core'
import { v7 as uuidv7 } from 'uuid'

import type { FlattenedFieldValue } from './@types.js'

// ------------------------------------------------------------------------------
// Flattening logic: take a document's nested field data and flatten it into an
// array of field values with associated metadata such as field path and locale.
// ------------------------------------------------------------------------------

/**
 * Main entrypoint for flattening a document's (nested) field data into a flat
 * array of field values.
 *
 * @param fields - The field definitions for the collection.
 * @param data - The document's field data to flatten.
 * @param locale - The locale to flatten for (or 'all' to flatten all locales).
 */
export const flattenFieldSetData = (
  fields: FieldSet,
  data: unknown,
  locale: string
): FlattenedFieldValue[] => {
  return Array.from(flattenFieldSetDataGen(fields, data, locale))
}

/**
 * Flatten data for a FieldSet (Field[]) -- this could be the top-level field
 * data for a document, or the data inside a group, array or blocks field.
 *
 * @param fields - The field definitions for the current field set.
 * @param data - The field data for the current field set.
 * @param locale - The locale to flatten for (or 'all' to flatten all locales).
 * @param parent_path - The path segments leading up to the current field set.
 * @returns
 */
function* flattenFieldSetDataGen(
  fields: FieldSet,
  data: unknown,
  locale: string,
  parent_path: string[] = []
): Generator<FlattenedFieldValue> {
  if (data === undefined) {
    return
  }

  const fieldData = data as Record<string, unknown>
  for (const field of fields) {
    yield* flattenFieldDataGen(field, fieldData[field.name], locale, [...parent_path, field.name])
  }
}

/**
 * Flatten data for a single field.
 *
 * @param field - The field definition for the current field.
 * @param data - The field data for the current field.
 * @param locale - The locale to flatten for (or 'all' to flatten all locales).
 * @param field_path - The path segments up to and including the current field.
 * @returns
 */
function* flattenFieldDataGen(
  field: Field,
  data: unknown,
  locale: string,
  field_path: string[]
): Generator<FlattenedFieldValue> {
  if (data === undefined) {
    return
  }

  // Group fields are simple -- just use flattenFieldSetDataGen.  It will handle
  // adding the appropriate field names to field_path.
  if (field.type === 'group') {
    yield* flattenFieldSetDataGen(field.fields, data, locale, field_path)
  }

  // For array fields, we must emit a single FlattenedMetaFieldData for each
  // item to capture the item's stable ID, and then flatten the fields within
  // each item using flattenFieldSetDataGen().
  else if (field.type === 'array') {
    const items = data as ({ _id?: string } & Record<string, unknown>)[]
    for (let i = 0; i < items.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: i is always in-bounds
      const { _id, ...item_data } = items[i]!
      const item_path = [...field_path, `${i}`]

      yield {
        locale: 'all',
        field_path: item_path,
        field_type: 'meta',
        type: 'array_item',
        item_id: _id ?? uuidv7(),
        meta: null,
      }

      yield* flattenFieldSetDataGen(field.fields, item_data, locale, item_path)
    }
  }

  // Blocks are similar to arrays, but with an additional type discriminator for
  // block variants.
  else if (field.type === 'blocks') {
    const items = data as ({ _id?: string; _type: string } & Record<string, unknown>)[]
    for (let i = 0; i < items.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: i is always in-bounds
      const { _id, _type, ...item_data } = items[i]!
      const item_path = [...field_path, `${i}`, _type]

      const block = field.blocks.find((f) => f.blockType === _type)
      if (!block) {
        throw ERR_DATABASE({
          message: `invalid block type: ${_type}`,
          details: { blockType: _type },
        }).log(getLogger())
      }

      yield {
        locale: 'all',
        field_path: item_path,
        field_type: 'meta',
        type: 'group',
        item_id: _id ?? uuidv7(),
        meta: null,
      }

      yield* flattenFieldSetDataGen(block.fields, item_data, locale, item_path)
    }
  }

  // Handle localized fields separately.
  else if (field.localized) {
    // If locale is 'all', data is expected to be an object that maps locales to
    // the corresponding localized values, and we emit a separate
    // FlattenedFieldData for each.
    if (locale === 'all') {
      const localizedData = data as Record<string, unknown>
      for (const [locale, value] of Object.entries(localizedData)) {
        if (value !== undefined) {
          yield flattenValueFieldData(field, field_path, value, locale)
        }
      }
    }

    // If locale is not 'all', data is expected to be a single localized value
    // for the specified locale, and we emit a single FlattenedFieldData for
    // that locale.
    else {
      yield flattenValueFieldData(field, field_path, data, locale)
    }
  }

  // For non-localized fields, data is expected to be the (non-localized) field
  // value, and we emit a single FlattenedFieldData with locale 'all'.
  else {
    yield flattenValueFieldData(field, field_path, data, 'all')
  }
}

const flattenValueFieldData = (
  field: ValueField,
  field_path: string[],
  value: unknown,
  locale: string
): FlattenedFieldValue => {
  const field_type = field.type

  switch (field_type) {
    case 'text':
    case 'textArea':
    case 'select':
      return {
        locale,
        field_path,
        field_type: 'text',
        value: value as string,
      }

    case 'float':
      return {
        locale,
        field_path,
        field_type: 'numeric',
        number_type: 'float',
        value_float: value as number,
      }

    case 'integer':
      return {
        locale,
        field_path,
        field_type: 'numeric',
        number_type: 'integer',
        value_integer: value as number,
      }

    case 'decimal':
      return {
        locale,
        field_path,
        field_type: 'numeric',
        number_type: 'decimal',
        value_decimal: value as string,
      }

    case 'boolean':
    case 'checkbox':
      return {
        locale,
        field_path,
        field_type: 'boolean',
        value: value as boolean,
      }

    case 'time':
      return {
        locale,
        field_path,
        field_type: 'datetime',
        date_type: 'time',
        value_time: value as string,
      }

    case 'date':
      return {
        locale,
        field_path,
        field_type: 'datetime',
        date_type: 'date',
        value_date: value as Date,
      }

    case 'datetime':
      return {
        locale,
        field_path,
        field_type: 'datetime',
        date_type: 'datetime',
        value_timestamp_tz: value as Date,
      }

    case 'file':
    case 'image': {
      const v = value as StoredFileValue
      return {
        locale,
        field_path,
        field_type: 'file',
        file_id: v.fileId,
        filename: v.filename,
        original_filename: v.originalFilename,
        mime_type: v.mimeType,
        file_size: v.fileSize,
        storage_provider: v.storageProvider,
        storage_path: v.storagePath,
        storage_url: v.storageUrl,
        file_hash: v.fileHash,
        image_width: v.imageWidth,
        image_height: v.imageHeight,
        image_format: v.imageFormat,
        processing_status: v.processingStatus,
        thumbnail_generated: v.thumbnailGenerated,
      }
    }

    case 'relation': {
      const v = value as RelatedDocumentValue
      return {
        locale,
        field_path,
        field_type: 'relation',
        target_document_id: v.targetDocumentId,
        target_collection_id: v.targetCollectionId,
        relationship_type: v.relationshipType,
        cascade_delete: v.cascadeDelete,
      }
    }

    case 'richText':
    case 'json':
    case 'object':
      return {
        locale,
        field_path,
        field_type: 'json',
        value,
      }

    default:
      throw ERR_DATABASE({
        message: `unsupported field type: ${field_type}`,
        details: { fieldType: field_type },
      }).log(getLogger())
  }
}
