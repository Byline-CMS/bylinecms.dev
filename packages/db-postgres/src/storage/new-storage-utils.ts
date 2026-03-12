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

interface BaseFlattenedFieldData {
  locale: string
  field_path: string[]
}

interface FlattenedStringFieldData extends BaseFlattenedFieldData {
  field_type: 'text' | 'textArea' | 'select'
  value: string
}

interface FlattenedNumericFieldData extends BaseFlattenedFieldData {
  field_type: 'float' | 'integer' | 'decimal'
  number_type: 'float' | 'integer' | 'decimal'
  value_float?: number
  value_integer?: number
  value_decimal?: string
}

interface FlattenedBooleanFieldData extends BaseFlattenedFieldData {
  field_type: 'boolean' | 'checkbox'
  value: boolean
}

interface FlattenedDateTimeFieldData extends BaseFlattenedFieldData {
  field_type: 'datetime' | 'date' | 'time'
  date_type: 'datetime' | 'date' | 'time'
  value_time?: string
  value_date?: Date
  value_timestamp_tz?: Date
}

interface FlattenedFileFieldData extends BaseFlattenedFieldData {
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

interface FlattenedRelationFieldData extends BaseFlattenedFieldData {
  field_type: 'relation'
  target_document_id: string
  target_collection_id: string
  relationship_type?: string
  cascade_delete?: boolean
}

interface FlattenedRichTextFieldData extends BaseFlattenedFieldData {
  field_type: 'richText'
  value: unknown // JSON-serializable rich text content
}

interface FlattenedJsonFieldData extends BaseFlattenedFieldData {
  field_type: 'json' | 'object'
  value: unknown // JSON-serializable data
  // json_schema?: object
  // object_keys?: string[]
}

interface FlattenedMetaFieldData extends BaseFlattenedFieldData {
  field_type: 'meta'
  type: 'array_item' | 'group'
  item_id: string
  meta?: unknown
}

export type FlattenedFieldData =
  | FlattenedStringFieldData
  | FlattenedNumericFieldData
  | FlattenedBooleanFieldData
  | FlattenedDateTimeFieldData
  | FlattenedFileFieldData
  | FlattenedRelationFieldData
  | FlattenedRichTextFieldData
  | FlattenedJsonFieldData
  | FlattenedMetaFieldData

export const flattenFieldSetData = (
  fields: Field[],
  data: unknown,
  locale: string
): FlattenedFieldData[] => {
  return Array.from(flattenFieldSetDataGen(fields, data, locale))
}

function* flattenFieldSetDataGen(
  fields: FieldSet,
  data: unknown,
  locale: string,
  parent_path: string[] = []
): Generator<FlattenedFieldData> {
  if (data === undefined) {
    return
  }

  const fieldData = data as Record<string, unknown>
  for (const field of fields) {
    yield* flattenFieldDataGen(field, fieldData[field.name], locale, [...parent_path, field.name])
  }
}

function* flattenFieldDataGen(
  field: Field,
  data: unknown,
  locale: string,
  field_path: string[]
): Generator<FlattenedFieldData> {
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
    // If locale is 'all', data should be a mapping of locales to the corresponding localized
    // values, and we should emit a separate FlattenedFieldData for each.
    if (locale === 'all') {
      const localizedData = data as Record<string, unknown>
      for (const [locale, value] of Object.entries(localizedData)) {
        if (value !== undefined) {
          yield flattenValueFieldData(field, field_path, value, locale)
        }
      }
    }

    // If locale is not 'all', data should be a single localized value for the
    // specified locale, and we should emit a single FlattenedFieldData for that locale.
    else {
      yield flattenValueFieldData(field, field_path, data, locale)
    }
  }

  // For non-localized fields, data should just be the (non-localized) field value, and
  // we emit a single FlattenedFieldData with locale 'all'.
  else {
    yield flattenValueFieldData(field, field_path, data, 'all')
  }
}

const flattenValueFieldData = (
  field: ValueField,
  field_path: string[],
  value: unknown,
  locale: string
): FlattenedFieldData => {
  const field_type = field.type

  switch (field_type) {
    case 'text':
    case 'textArea':
    case 'select':
      return {
        locale,
        field_path,
        field_type,
        value: value as string,
      }

    case 'float':
      return {
        locale,
        field_path,
        field_type,
        number_type: 'float',
        value_float: value as number,
      }

    case 'integer':
      return {
        locale,
        field_path,
        field_type,
        number_type: 'integer',
        value_integer: value as number,
      }

    case 'decimal':
      return {
        locale,
        field_path,
        field_type,
        number_type: 'decimal',
        value_decimal: value as string,
      }

    case 'boolean':
    case 'checkbox':
      return {
        locale,
        field_path,
        field_type,
        value: value as boolean,
      }

    case 'time':
      return {
        locale,
        field_path,
        field_type,
        date_type: 'time',
        value_time: value as string,
      }

    case 'date':
      return {
        locale,
        field_path,
        field_type,
        date_type: 'date',
        value_date: value as Date,
      }

    case 'datetime':
      return {
        locale,
        field_path,
        field_type,
        date_type: 'datetime',
        value_timestamp_tz: value as Date,
      }

    case 'file':
    case 'image': {
      const v = value as FileStore
      return {
        locale,
        field_path,
        field_type,
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
        field_type,
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
        field_type,
        value,
      }

    default:
      throw new Error(`Unsupported field type: ${field_type}`)
  }
}

type NormalizedFields = {
  text: (typeof textStore.$inferInsert)[]
  numeric: (typeof numericStore.$inferInsert)[]
  boolean: (typeof booleanStore.$inferInsert)[]
  datetime: (typeof datetimeStore.$inferInsert)[]
  file: (typeof fileStore.$inferInsert)[]
  relation: (typeof relationStore.$inferInsert)[]
  json: (typeof jsonStore.$inferInsert)[]
  meta: (typeof metaStore.$inferInsert)[]
}

export const groupAndNormalizeFlattenedFields = (
  flattenedFields: FlattenedFieldData[],
  document_version_id: string,
  collection_id: string
): NormalizedFields => {
  const buckets: NormalizedFields = {
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
      case 'textArea':
      case 'select':
        buckets.text.push({ ...base, value: field.value })
        continue

      case 'float':
      case 'integer':
      case 'decimal':
        buckets.numeric.push({
          ...base,
          number_type: field.number_type,
          value_float: field.value_float,
          value_integer: field.value_integer,
          value_decimal: field.value_decimal,
        })
        continue

      case 'boolean':
      case 'checkbox':
        buckets.boolean.push({
          ...base,
          value: field.value,
        })
        continue

      case 'datetime':
      case 'date':
      case 'time':
        buckets.datetime.push({
          ...base,
          date_type: field.date_type,
          value_date: field.value_date?.toISOString(), // TODO: Is this the appropriate conversion?
          value_time: field.value_time,
          value_timestamp_tz: field.value_timestamp_tz,
        })
        continue

      case 'file':
      case 'image':
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

      case 'richText':
      case 'json':
      case 'object':
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

export const restoreFieldSetData = (
  fields: Field[],
  flattenedData: FlattenedFieldData[]
): { result: any; warnings: string[] } => {
  const result: any = {}
  const warnings: string[] = []

  for (const item of flattenedData) {
    // biome-ignore lint/style/noNonNullAssertion: TODO: put in a proper check here?
    const fieldName = item.field_path[0]!
    const field = fields.find((f) => f.name === fieldName)
    if (!field) {
      warnings.push(`Field ${fieldName} not found`)
    } else {
      result[fieldName] = restoreFieldData(field, result[fieldName], item, 1, warnings)
    }
  }

  return { result, warnings }
}

const restoreFieldData = (
  field: Field,
  target: any,
  data: FlattenedFieldData,
  pathIndex: number,
  warnings: string[]
): any => {
  if (field.type === 'group') {
    return restoreGroupFieldData(field, target, data, pathIndex, warnings)
  } else if (field.type === 'array') {
    return restoreArrayFieldData(field, target, data, pathIndex, warnings)
  } else if (field.type === 'blocks') {
    return restoreBlocksFieldData(field, target, data, pathIndex, warnings)
  }

  if (field.localized) {
    if (data.locale === 'all') {
      warnings.push(
        `Received non-localized data for localized field at path ${data.field_path.join('.')}`
      )
    } else {
      target = target || {}
      target[data.locale] = extractLeafFieldData(data)
    }
  } else {
    if (data.locale !== 'all') {
      warnings.push(
        `Received localized data for non-localized field at path ${data.field_path.join('.')}`
      )
    } else {
      target = extractLeafFieldData(data)
    }
  }

  return target
}

const restoreGroupFieldData = (
  field: GroupField,
  target: any,
  data: FlattenedFieldData,
  pathIndex: number,
  warnings: string[]
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
  target[fieldName] = restoreFieldData(subField, target[fieldName], data, pathIndex + 1, warnings)
  return target
}

const restoreArrayFieldData = (
  field: ArrayField,
  target: any,
  data: FlattenedFieldData,
  pathIndex: number,
  warnings: string[]
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
    warnings
  )
  return target
}

const restoreBlocksFieldData = (
  field: BlocksField,
  target: any,
  data: FlattenedFieldData,
  pathIndex: number,
  warnings: string[]
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
    warnings
  )
  return target
}

const extractLeafFieldData = (data: FlattenedFieldData): unknown => {
  switch (data.field_type) {
    case 'text':
    case 'textArea':
    case 'select':
    case 'boolean':
    case 'checkbox':
    case 'richText':
    case 'json':
    case 'object':
      return data.value

    case 'float':
      return data.value_float

    case 'integer':
      return data.value_integer

    case 'decimal':
      return data.value_decimal

    case 'time':
      return data.value_time

    case 'date':
      return data.value_date

    case 'datetime':
      return data.value_timestamp_tz

    case 'file':
    case 'image':
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

// const DocsCollectionConfig: CollectionDefinition = {
//   path: 'docs',
//   labels: {
//     singular: 'Document',
//     plural: 'Documents',
//   },
//   fields: [
//     { name: 'path', type: 'text', unique: true },
//     { name: 'title', type: 'text', localized: true },
//     { name: 'summary', type: 'text', localized: true },
//     { name: 'category', type: 'relation', targetCollection: 'categories', optional: true },
//     {
//       name: 'publishedOn',
//       type: 'datetime',
//       mode: 'datetime',
//       optional: true,
//     },
//     {
//       name: 'featured',
//       label: 'Featured',
//       type: 'checkbox',
//       optional: true,
//       helpText: 'Is this page featured on the home page?',
//     },
//     { name: 'views', type: 'integer', optional: true },
//     { name: 'price', label: 'Price', type: 'decimal', optional: true },

//     {
//       name: 'content',
//       type: 'blocks',
//       fields: [
//         {
//           name: 'richTextBlock',
//           type: 'group',
//           fields: [
//             { name: 'constrainedWidth', type: 'boolean', optional: true },
//             { name: 'richText', type: 'richText', localized: true },
//           ],
//         },
//         {
//           name: 'photoBlock',
//           type: 'group',
//           fields: [
//             { name: 'display', type: 'text', optional: true },
//             { name: 'photo', type: 'image' },
//             { name: 'alt', type: 'text', localized: false },
//             { name: 'caption', type: 'richText', optional: true, localized: true },
//           ],
//         },
//       ],
//     },
//     {
//       name: 'reviews',
//       type: 'array',
//       fields: [
//         {
//           name: 'reviewItem',
//           type: 'group',
//           fields: [
//             { name: 'rating', type: 'integer' },
//             { name: 'comment', type: 'richText', localized: false },
//           ],
//         },
//       ],
//     },
//     {
//       name: 'links',
//       type: 'array',
//       fields: [{ name: 'link', type: 'text' }],
//     },
//   ],
// }

// const filedId = uuidv7()

// // Complex test document with many fields and arrays
// const sampleDocument = {
//   path: 'my-first-document',
//   title: {
//     en: 'My First Document',
//     es: 'Mi Primer Documento',
//     fr: 'Mon Premier Document',
//   },
//   summary: {
//     en: 'This is a sample document for testing purposes.',
//     es: 'Este es un documento de muestra para fines de prueba.',
//     fr: "Il s'agit d'un document d'exemple à des fins de test.",
//   },
//   // category: {
//   //   target_collection_id: "cat-123",
//   //   target_document_id: "electronics-audio"
//   // },
//   publishedOn: new Date('2024-01-15T10:00:00'),
//   featured: true,
//   views: 100,
//   price: '19.99',
//   content: [
//     {
//       _id: '4d0bcb7f-4fdd-4c81-bdc3-8e747beed1e1',
//       _type: 'richTextBlock',
//       constrainedWidth: true,
//       richText: {
//         en: { root: { paragraph: 'Some text here...' } },
//         es: { root: { paragraph: 'Some spanish text here' } },
//       },
//     },
//     {
//       _id: 'b29b3170-2017-4261-ba06-bbbb4437b8bd',
//       _type: 'photoBlock',
//       display: 'wide',
//       photo: {
//         file_id: filedId,
//         filename: 'docs-photo-01.jpg',
//         original_filename: 'some-original-filename.jpg',
//         mime_type: 'image/jpeg',
//         file_size: 123456,
//         storage_provider: 'local',
//         storage_path: 'uploads/docs-photo-01.jpg',
//       },
//       alt: 'Some alt text here',
//       caption: {
//         en: { root: { paragraph: 'Some text here...' } },
//         es: { root: { paragraph: 'Some spanish text here...' } },
//       },
//     },
//   ],
//   reviews: [
//     {
//       _id: '8b94fa68-fd52-4482-8541-6626a4e12e2b',
//       reviewItem: {
//         rating: 6,
//         comment: { root: { paragraph: 'Some review text here...' } },
//       },
//     },
//     {
//       _id: '3b9ceaa3-d67f-429e-93b3-cffabe4a2e09',
//       reviewItem: {
//         rating: 2,
//         comment: { root: { paragraph: 'Some more reviews here...' } },
//       },
//     },
//   ],
//   links: [
//     { _id: '42ba6f30-60f6-4cbc-a138-873fa3c4b966', link: 'https://example.com' },
//     { _id: 'b0488cf7-814f-40d3-bab9-d436d155e4e4', link: 'https://another-example.com' },
//   ],
// }

// const flattened = flattenFieldSetData(DocsCollectionConfig.fields, sampleDocument, 'all').map(
//   ({ locale, field_path, field_type, ...rest }) => ({
//     field_path: field_path.join('.'),
//     field_name: field_path[field_path.length - 1],
//     locale,
//     parent_path: field_path.length > 1 ? field_path.slice(0, -1).join('.') : undefined,
//     field_type,
//     ...rest,
//   })
// )
// // const restored = restoreFieldSetData(DocsCollectionConfig.fields, flattened)

// console.dir(flattened, { depth: null })
// // console.dir(restored, { depth: null })
