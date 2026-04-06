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
  FileStore,
  GroupField,
  ValueField,
} from '@byline/core'
import { v7 as uuidv7 } from 'uuid'

import { fieldTypeToStoreType, type StoreType } from './storage-template-queries.js'
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
import type { FlattenedFieldValue, UnifiedFieldValue } from './@types.js'

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
        throw new Error(`Invalid block type: ${_type}`)
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
      const v = value as FileStore
      return {
        locale,
        field_path,
        field_type: 'file',
        file_id: v.file_id,
        filename: v.filename,
        original_filename: v.original_filename,
        mime_type: v.mime_type,
        file_size: v.file_size,
        storage_provider: v.storage_provider,
        storage_path: v.storage_path,
        storage_url: v.storage_url,
        file_hash: v.file_hash,
        image_width: v.image_width,
        image_height: v.image_height,
        image_format: v.image_format,
        processing_status: v.processing_status,
        thumbnail_generated: v.thumbnail_generated,
      }
    }

    case 'relation': {
      const v = value as any // TODO: RelationStore type or similar?
      return {
        locale,
        field_path,
        field_type: 'relation',
        target_document_id: v.target_document_id,
        target_collection_id: v.target_collection_id,
        relationship_type: v.relationship_type,
        cascade_delete: v.cascade_delete,
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
      throw new Error(`Unsupported field type: ${field_type}`)
  }
}

// ------------------------------------------------------------------------------
// Restoration logic: take flattened field data and restore it to the original
// nested structure.
// ------------------------------------------------------------------------------

export class ReconstructionError extends Error {
  warnings: string[]
  constructor(warnings: string[]) {
    super(`Document reconstruction failed with ${warnings.length} warnings`)
    this.warnings = warnings
  }
}

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
    const field = fields.find((f) => f.name === fieldName)
    if (!field) {
      warnings.push(`Field ${fieldName} not found`)
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
    throw new ReconstructionError(warnings)
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
    warnings.push(`Sub-field ${fieldName} not found in group ${field.name}`)
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
    warnings.push(`Sub-field ${fieldName} not found in array ${field.name}`)
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
    warnings.push(`Block type '${blockType}' not found in blocks field ${field.name}`)
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
    warnings.push(
      `Invalid field name '${data.field_path[pathIndex + 2]}' in path ${data.field_path.join('.')}`
    )
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
        throw new Error(`Unsupported number type: ${data.number_type}`)
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
        throw new Error(`Unsupported date type: ${data.date_type}`)
      }
    }

    case 'file':
      return {
        file_id: data.file_id,
        filename: data.filename,
        original_filename: data.original_filename,
        mime_type: data.mime_type,
        file_size: data.file_size,
        storage_provider: data.storage_provider,
        storage_path: data.storage_path,
        storage_url: data.storage_url,
        file_hash: data.file_hash,
        image_width: data.image_width,
        image_height: data.image_height,
        image_format: data.image_format,
        processing_status: data.processing_status,
        thumbnail_generated: data.thumbnail_generated,
      }

    case 'relation':
      return {
        target_document_id: data.target_document_id,
        target_collection_id: data.target_collection_id,
        relationship_type: data.relationship_type,
        cascade_delete: data.cascade_delete,
      }
  }
}

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
        throw new Error(`Unexpected field type: ${field_type}`)
    }
  }

  return buckets
}

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
      throw new Error(`Unexpected field type: ${unifiedValue.field_type}`)
  }
}

const orUndefined = <T>(value: T | null): T | undefined => {
  return value === null ? undefined : value
}

// ------------------------------------------------------------------------------
// Field name → store type resolution
// ------------------------------------------------------------------------------

/**
 * Given a CollectionDefinition and a list of field names, determine which
 * StoreTypes are needed to satisfy the query. This enables selective field
 * loading — instead of a 7-table UNION ALL, we query only the relevant stores.
 *
 * Field names that don't match a collection field (e.g. 'status', 'updated_at')
 * are silently ignored — they come from the document version row, not EAV stores.
 *
 * Structure fields (array, blocks) recursively include all their children's
 * store types plus 'meta' for _id/_type tracking.
 */
export function resolveStoreTypes(fields: FieldSet, fieldNames: string[]): Set<StoreType> {
  const stores = new Set<StoreType>()

  for (const name of fieldNames) {
    const field = fields.find((f) => f.name === name)
    if (!field) continue
    collectStoreTypes(field, stores)
  }

  return stores
}

function collectStoreTypes(field: Field, stores: Set<StoreType>): void {
  const mapped = fieldTypeToStoreType[field.type]

  if (mapped === 'meta') {
    // Structure field — recurse into children and include meta for _id/_type
    if (field.type === 'array') {
      for (const child of field.fields) {
        collectStoreTypes(child, stores)
      }
    } else if (field.type === 'blocks') {
      for (const block of field.blocks) {
        for (const child of block.fields) {
          collectStoreTypes(child, stores)
        }
      }
    }
    // Meta rows are fetched separately (not via UNION ALL), so no store type to add
  } else if (mapped) {
    stores.add(mapped)
  }
  // undefined (group) or unrecognized — recurse if group
  if (field.type === 'group') {
    for (const child of (field as GroupField).fields) {
      collectStoreTypes(child, stores)
    }
  }
}

export const getFirstOrThrow =
  <T>(message: string) =>
  (values: T[]): T => {
    const value = values[0]
    if (value == null) {
      throw new Error(message)
    }
    return value
  }
