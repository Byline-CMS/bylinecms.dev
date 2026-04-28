/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { ArrayField, BlocksField, Field, FieldSet, GroupField } from '@byline/core'
import { ERR_DATABASE, getLogger, RESERVED_FIELD_NAMES } from '@byline/core'

import type { FlattenedFieldValue, UnifiedFieldValue } from './@types.js'

// ------------------------------------------------------------------------------
// Restoration logic: take flattened field data and restore it to the original
// nested structure.
// ------------------------------------------------------------------------------

/**
 * Main entrypoint for restoring a document's field data from flattened form
 * back into the original nested structure.
 *
 * @param fields - The field definitions for the collection.
 * @param flattenedData - The flattened field data to restore.
 */
export const restoreFieldSetData = (
  fields: FieldSet,
  flattenedData: FlattenedFieldValue[],
  resolveLocale?: string
): any => {
  const result: any = {}
  const warnings: string[] = []

  for (const item of flattenedData) {
    // biome-ignore lint/style/noNonNullAssertion: TODO: put in a proper check here?
    const fieldName = item.field_path[0]!
    // Reserved system attributes (e.g. `path`) live on `documentVersions`,
    // not in the schema field tree. Silently skip orphan rows that may
    // remain in store_* tables from earlier schemas where these names
    // were declared as user fields.
    if (RESERVED_FIELD_NAMES.has(fieldName)) {
      continue
    }
    const field = fields.find((f) => f.name === fieldName)
    if (!field) {
    } else {
      result[fieldName] = restoreFieldData(
        field,
        result[fieldName],
        item,
        1,
        warnings,
        resolveLocale
      )
    }
  }

  // Array/blocks/group fixup.
  for (const field of fields) {
    if ((field.type === 'array' || field.type === 'blocks') && !field.optional) {
      result[field.name] = result[field.name] || []
    } else if (field.type === 'group' && !field.optional) {
      result[field.name] = result[field.name] || {}
    }
  }

  if (warnings.length > 0) {
    throw ERR_DATABASE({
      message: `document reconstruction failed with ${warnings.length} warnings`,
      details: { warnings },
    }).log(getLogger())
  }

  return result
}

const restoreFieldData = (
  field: Field,
  target: any,
  data: FlattenedFieldValue,
  pathIndex: number,
  warnings: string[],
  resolveLocale?: string
): any => {
  if (field.type === 'group') {
    return restoreGroupFieldData(field, target, data, pathIndex, warnings, resolveLocale)
  } else if (field.type === 'array') {
    return restoreArrayFieldData(field, target, data, pathIndex, warnings, resolveLocale)
  } else if (field.type === 'blocks') {
    return restoreBlocksFieldData(field, target, data, pathIndex, warnings, resolveLocale)
  }

  if (field.localized) {
    if (data.locale === 'all') {
      warnings.push(
        `Received non-localized data for localized field at path ${data.field_path.join('.')}`
      )
    } else if (resolveLocale) {
      // When resolving a specific locale, only accept the matching locale row
      // and set the value directly instead of wrapping in { locale: value }.
      if (data.locale === resolveLocale) {
        target = extractValueFieldData(data)
      }
    } else {
      target = target || {}
      target[data.locale] = extractValueFieldData(data)
    }
  } else {
    if (data.locale !== 'all') {
      warnings.push(
        `Received localized data for non-localized field at path ${data.field_path.join('.')}`
      )
    } else {
      target = extractValueFieldData(data)
    }
  }

  return target
}

const restoreGroupFieldData = (
  field: GroupField,
  target: any,
  data: FlattenedFieldValue,
  pathIndex: number,
  warnings: string[],
  resolveLocale?: string
): any => {
  if (pathIndex >= data.field_path.length) {
    warnings.push(`Path ended unexpectedly while restoring group: ${data.field_path.join('.')}`)
    return target
  }

  // biome-ignore lint/style/noNonNullAssertion: pathIndex is assumed to be a non-negative integer
  const fieldName = data.field_path[pathIndex]!
  const subField = field.fields.find((f) => f.name === fieldName)

  if (subField == null) {
    // Sub-field was removed from the schema; silently skip orphaned rows.
    return target
  }

  target = target || {}
  target[fieldName] = restoreFieldData(
    subField,
    target[fieldName],
    data,
    pathIndex + 1,
    warnings,
    resolveLocale
  )
  return target
}

const restoreArrayFieldData = (
  field: ArrayField,
  target: any,
  data: FlattenedFieldValue,
  pathIndex: number,
  warnings: string[],
  resolveLocale?: string
): any => {
  if (pathIndex >= data.field_path.length) {
    warnings.push(`Path ended unexpectedly while restoring array: ${data.field_path.join('.')}`)
    return target
  }

  // biome-ignore lint/style/noNonNullAssertion: pathIndex is assumed to be a non-negative integer
  const arrayIndex = Number.parseInt(data.field_path[pathIndex]!, 10)
  if (Number.isNaN(arrayIndex) || arrayIndex < 0) {
    warnings.push(
      `Invalid array index '${data.field_path[pathIndex]}' in path ${data.field_path.join('.')}`
    )
    return target
  }

  target = target || []
  target[arrayIndex] = target[arrayIndex] || {}

  if (pathIndex + 1 === data.field_path.length) {
    if (data.field_type === 'meta') {
      target[arrayIndex]._id = data.item_id
    } else {
      warnings.push(
        `Expected meta field for array item but got ${data.field_type} at path ${data.field_path.join('.')}`
      )
    }
    return target
  }

  // biome-ignore lint/style/noNonNullAssertion: pathIndex is assumed to be a non-negative integer
  const fieldName = data.field_path[pathIndex + 1]!
  const subField = field.fields.find((f) => f.name === fieldName)

  if (subField == null) {
    // Sub-field was removed from the schema; silently skip orphaned rows.
    return target
  }

  target[arrayIndex][fieldName] = restoreFieldData(
    subField,
    target[arrayIndex][fieldName],
    data,
    pathIndex + 2,
    warnings,
    resolveLocale
  )
  return target
}

const restoreBlocksFieldData = (
  field: BlocksField,
  target: any,
  data: FlattenedFieldValue,
  pathIndex: number,
  warnings: string[],
  resolveLocale?: string
): any => {
  const arrayIndex = Number.parseInt(data.field_path[pathIndex] ?? '', 10)
  if (Number.isNaN(arrayIndex) || arrayIndex < 0) {
    warnings.push(
      `Invalid block index '${data.field_path[pathIndex]}' in path ${data.field_path.join('.')}`
    )
    return target
  }

  const blockType = data.field_path[pathIndex + 1]
  if (typeof blockType !== 'string') {
    warnings.push(
      `Invalid block type '${data.field_path[pathIndex + 1]}' in path ${data.field_path.join('.')}`
    )
    return target
  }

  const block = field.blocks.find((f) => f.blockType === blockType)
  if (block == null) {
    // Block type was removed from the schema; silently skip orphaned rows.
    return target
  }

  target = target || []
  target[arrayIndex] = target[arrayIndex] || {}

  if (pathIndex + 2 === data.field_path.length) {
    if (data.field_type === 'meta') {
      target[arrayIndex]._id = data.item_id
      target[arrayIndex]._type = blockType
    } else {
      warnings.push(
        `Expected meta field for block item but got ${data.field_type} at path ${data.field_path.join('.')}`
      )
    }
    return target
  }

  // biome-ignore lint/style/noNonNullAssertion: pathIndex is assumed to be a non-negative integer
  const fieldName = data.field_path[pathIndex + 2]!
  const subField = block.fields.find((f) => f.name === fieldName)
  if (subField == null) {
    // Sub-field was removed from the schema; silently skip orphaned rows.
    return target
  }

  target[arrayIndex][fieldName] = restoreFieldData(
    subField,
    target[arrayIndex][fieldName],
    data,
    pathIndex + 3,
    warnings,
    resolveLocale
  )
  return target
}

const extractValueFieldData = (data: FlattenedFieldValue): unknown => {
  switch (data.field_type) {
    case 'text':
      return data.value

    case 'boolean':
      return data.value

    case 'json':
      return data.value

    case 'numeric': {
      if (data.number_type === 'float') {
        return data.value_float
      } else if (data.number_type === 'integer') {
        return data.value_integer
      } else if (data.number_type === 'decimal') {
        return data.value_decimal
      } else {
        throw ERR_DATABASE({
          message: `unsupported number type: ${data.number_type}`,
          details: { numberType: data.number_type },
        }).log(getLogger())
      }
    }

    case 'datetime': {
      if (data.date_type === 'time') {
        return data.value_time
      } else if (data.date_type === 'date') {
        return data.value_date
      } else if (data.date_type === 'datetime') {
        return data.value_timestamp_tz
      } else {
        throw ERR_DATABASE({
          message: `unsupported date type: ${data.date_type}`,
          details: { dateType: data.date_type },
        }).log(getLogger())
      }
    }

    case 'file':
      return {
        fileId: data.file_id,
        filename: data.filename,
        originalFilename: data.original_filename,
        mimeType: data.mime_type,
        fileSize: data.file_size,
        storageProvider: data.storage_provider,
        storagePath: data.storage_path,
        storageUrl: data.storage_url,
        fileHash: data.file_hash,
        imageWidth: data.image_width,
        imageHeight: data.image_height,
        imageFormat: data.image_format,
        processingStatus: data.processing_status,
        thumbnailGenerated: data.thumbnail_generated,
      }

    case 'relation':
      return {
        targetDocumentId: data.target_document_id,
        targetCollectionId: data.target_collection_id,
        relationshipType: data.relationship_type,
        cascadeDelete: data.cascade_delete,
      }
  }
}

// ------------------------------------------------------------------------------
// Unified row extraction: convert a UNION-ALL `UnifiedFieldValue` row (the shape
// the adapter reads back from the seven store tables) into a `FlattenedFieldValue`
// ready to feed into `restoreFieldSetData`. Paired with restore because it's the
// read-path adapter between raw SQL results and the reconstruct pipeline.
// ------------------------------------------------------------------------------

export const extractFlattenedFieldValue = (
  unifiedValue: UnifiedFieldValue
): FlattenedFieldValue => {
  const baseValue = {
    locale: unifiedValue.locale,
    field_path: unifiedValue.field_path.split('.'),
  }

  switch (unifiedValue.field_type) {
    case 'text':
      return {
        ...baseValue,
        field_type: 'text',
        value: unifiedValue.text_value as string,
      }

    case 'numeric':
      return {
        ...baseValue,
        field_type: 'numeric',
        number_type: unifiedValue.number_type as 'integer' | 'float' | 'decimal',
        value_float: orUndefined(unifiedValue.value_float),
        value_integer: orUndefined(unifiedValue.value_integer),
        value_decimal: orUndefined(unifiedValue.value_decimal),
      }

    case 'boolean':
      return {
        ...baseValue,
        field_type: 'boolean',
        value: unifiedValue.boolean_value as boolean,
      }

    case 'datetime':
      return {
        ...baseValue,
        field_type: 'datetime',
        date_type: unifiedValue.date_type as 'date' | 'time' | 'datetime',
        value_date: orUndefined(unifiedValue.value_date),
        value_time: orUndefined(unifiedValue.value_time),
        value_timestamp_tz: orUndefined(unifiedValue.value_timestamp_tz),
      }

    case 'file':
      return {
        ...baseValue,
        field_type: 'file',
        file_id: unifiedValue.file_id as string,
        filename: unifiedValue.filename as string,
        original_filename: unifiedValue.original_filename as string,
        mime_type: unifiedValue.mime_type as string,
        file_size: unifiedValue.file_size as number,
        storage_provider: unifiedValue.storage_provider as string,
        storage_path: unifiedValue.storage_path as string,
        storage_url: orUndefined(unifiedValue.storage_url),
        file_hash: orUndefined(unifiedValue.file_hash),
        image_width: orUndefined(unifiedValue.image_width),
        image_height: orUndefined(unifiedValue.image_height),
        image_format: orUndefined(unifiedValue.image_format),
        processing_status: orUndefined(unifiedValue.processing_status),
        thumbnail_generated: orUndefined(unifiedValue.thumbnail_generated),
      }

    case 'relation':
      return {
        ...baseValue,
        field_type: 'relation',
        target_document_id: unifiedValue.target_document_id as string,
        target_collection_id: unifiedValue.target_collection_id as string,
        relationship_type: orUndefined(unifiedValue.relationship_type),
        cascade_delete: orUndefined(unifiedValue.cascade_delete),
      }

    case 'richText':
    case 'json':
      return {
        ...baseValue,
        field_type: 'json',
        value: unifiedValue.json_value,
      }

    case 'meta':
      return {
        ...baseValue,
        field_type: 'meta',
        type: unifiedValue.meta_type as 'group' | 'array_item',
        item_id: unifiedValue.meta_item_id as string,
      }

    default:
      throw ERR_DATABASE({
        message: `unexpected field type: ${unifiedValue.field_type}`,
        details: { fieldType: unifiedValue.field_type },
      }).log(getLogger())
  }
}

const orUndefined = <T>(value: T | null): T | undefined => {
  return value === null ? undefined : value
}
