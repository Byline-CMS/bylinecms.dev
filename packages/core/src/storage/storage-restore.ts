/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { RESERVED_FIELD_NAMES } from '../config/validate-collections.js'
import { ERR_DATABASE } from '../lib/errors.js'
import { getLogger } from '../lib/logger.js'
import type { ArrayField, BlocksField, Field, FieldSet, GroupField } from '../@types/index.js'
import type { FlattenedFieldValue, UnifiedFieldValue } from './storage-row-types.js'

// ------------------------------------------------------------------------------
// Restoration logic: take flattened field data and restore it to the original
// nested structure.
// ------------------------------------------------------------------------------

export interface UnavailableBlock {
  /** Instance path in the compacted document, e.g. sections[0].body. */
  fieldPath: string
  /** Position in the stored blocks array before compaction. */
  storedIndex: number
  blockType: string
  id?: string
}

// Shared across duplicate server module graphs, just like the logger registry.
const loggedVersionsKey = Symbol.for('byline.unavailable-block-versions')
const processState = globalThis as typeof globalThis & { [loggedVersionsKey]?: Set<string> }
processState[loggedVersionsKey] ??= new Set<string>()
const loggedVersions = processState[loggedVersionsKey]

type UnavailableByArray = Map<any[], Map<number, Omit<UnavailableBlock, 'fieldPath'>>>

export interface RestoreResult {
  data: any
  warnings: string[]
  unavailableBlocks: UnavailableBlock[]
}

/**
 * Options that let restore read rows written under a previous `localized`
 * flag (specs/2026-11-09-localized-toggle-spec.md, 4.1, 4.2 and 4.2a).
 */
export interface RestoreOptions {
  /**
   * The document's source locale (`source_locale ?? defaultContentLocale`).
   * A now-shared field with no shared row reads this locale's row. When
   * omitted, `resolveLocale` stands in for it.
   */
  sourceLocale?: string
  /**
   * Map-shaped reads only: the locales under which a now-localized field's
   * shared row is reported when the field has no locale row of its own. When
   * omitted, `[sourceLocale]` is used if a source locale is known, else none.
   */
  conversionLocales?: readonly string[]
  /**
   * Withhold every value of a currently localized field, including a shared
   * row stored before the toggle (public reads of an ineligible locale).
   * Non-localized fields are kept.
   */
  withholdLocalized?: boolean
}

interface RestoreContext {
  warnings: string[]
  unavailableByArray: UnavailableByArray
  resolveLocale?: string
  options: RestoreOptions
  /**
   * Precedence of the row that produced each leaf value so far, keyed by the
   * leaf's storage path (plus the locale for map-shaped localized values).
   * A row replaces the current value only when its precedence is at least as
   * high, so the outcome never depends on row order.
   */
  precedence: Map<string, number>
}

// Leaf precedence. A localized field prefers its locale row to a shared row
// left over from before the toggle; a non-localized field prefers its shared
// row to a source-locale row left over from before the toggle. Rows of any
// other locale on a non-localized field are ignored.
const CONVERTED_ROW = 1
const NATIVE_ROW = 2

/**
 * Main entrypoint for restoring a document's field data from flattened form
 * back into the original nested structure.
 *
 * Always returns `{ data, warnings, unavailableBlocks }`. Warnings carry per-row reasons (e.g.
 * "Invalid block index 'undefined'") that are typically the result of a
 * collection schema change leaving orphan rows behind. Callers decide what
 * to do with them — strict reads reject any non-empty `warnings`, lenient
 * reads (the admin edit path) surface them to the UI.
 *
 * Rows written under a field's previous `localized` flag are converted
 * rather than warned about; see `RestoreOptions`.
 *
 * @param fields - The field definitions for the collection.
 * @param flattenedData - The flattened field data to restore.
 * @param resolveLocale - Restore a single locale; omit for a map-shaped read.
 * @param identity - Used only to log unavailable blocks once per version.
 * @param options - Conversion inputs for toggled `localized` flags.
 */
export const restoreFieldSetData = (
  fields: FieldSet,
  flattenedData: FlattenedFieldValue[],
  resolveLocale?: string,
  identity?: { collectionPath: string; documentId: string; versionId: string },
  options: RestoreOptions = {}
): RestoreResult => {
  const result: any = {}
  const warnings: string[] = []
  const unavailableByArray: UnavailableByArray = new Map()
  const ctx: RestoreContext = {
    warnings,
    unavailableByArray,
    resolveLocale,
    options,
    precedence: new Map(),
  }

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
      result[fieldName] = restoreFieldData(field, result[fieldName], item, 1, ctx)
    }
  }

  // Array/blocks/group/hasMany-relation fixup — a required list-shaped field
  // with no stored rows reconstructs as an empty array rather than absent.
  for (const field of fields) {
    if (
      (field.type === 'array' ||
        field.type === 'blocks' ||
        (field.type === 'relation' && field.hasMany)) &&
      !field.optional
    ) {
      result[field.name] = result[field.name] || []
    } else if (field.type === 'group' && !field.optional) {
      result[field.name] = result[field.name] || {}
    }
  }

  const unavailableBlocks: UnavailableBlock[] = []
  // Finish only after all rows (including identity metadata) have been read.
  // Walk parents before children so nested report paths use compacted indices.
  const finish = (fields: FieldSet, value: any, prefix = '') => {
    for (const field of fields) {
      const path = prefix ? `${prefix}.${field.name}` : field.name
      const child = value?.[field.name]
      if (field.type === 'group' && child) finish(field.fields, child, path)
      if ((field.type === 'blocks' || field.type === 'array') && Array.isArray(child)) {
        for (const issue of [...(unavailableByArray.get(child)?.values() ?? [])].sort(
          (a, b) => a.storedIndex - b.storedIndex
        ))
          unavailableBlocks.push({ fieldPath: path, ...issue })
        const compacted = child.filter((item) => item != null)
        value[field.name] = compacted
        compacted.forEach((item, index) => {
          const itemFields =
            field.type === 'array'
              ? field.fields
              : field.blocks.find((block) => block.blockType === item._type)?.fields
          if (itemFields) finish(itemFields, item, `${path}[${index}]`)
        })
      }
    }
  }
  finish(fields, result)
  if (identity && unavailableBlocks.length > 0) {
    const key = JSON.stringify([identity.collectionPath, identity.documentId, identity.versionId])
    if (!loggedVersions.has(key)) {
      loggedVersions.add(key)
      getLogger().warn(
        {
          ...identity,
          blockTypes: [...new Set(unavailableBlocks.map((issue) => issue.blockType))],
        },
        'Document contains unavailable blocks; saving content will remove them'
      )
    }
  }
  return { data: result, warnings, unavailableBlocks }
}

const restoreFieldData = (
  field: Field,
  target: any,
  data: FlattenedFieldValue,
  pathIndex: number,
  ctx: RestoreContext
): any => {
  if (field.type === 'group') {
    return restoreGroupFieldData(field, target, data, pathIndex, ctx)
  } else if (field.type === 'array') {
    return restoreArrayFieldData(field, target, data, pathIndex, ctx)
  } else if (field.type === 'blocks') {
    return restoreBlocksFieldData(field, target, data, pathIndex, ctx)
  } else if (field.type === 'relation' && field.hasMany) {
    return restoreMultiRelationFieldData(target, data, pathIndex, ctx.warnings)
  }

  const { resolveLocale, options, precedence } = ctx
  const leafKey = data.field_path.join('.')
  // Accept a row for `key` at `rank` when nothing of higher precedence is
  // already there; an equal rank keeps the previous last-row-wins behaviour.
  const accept = (key: string, rank: number): boolean => {
    if ((precedence.get(key) ?? 0) > rank) return false
    precedence.set(key, rank)
    return true
  }

  if (field.localized) {
    if (options.withholdLocalized) return target
    if (resolveLocale) {
      // Single-locale read: the matching locale row, else a shared row (4.1).
      if (data.locale === resolveLocale) {
        if (accept(leafKey, NATIVE_ROW)) target = extractValueFieldData(data)
      } else if (data.locale === 'all') {
        if (accept(leafKey, CONVERTED_ROW)) target = extractValueFieldData(data)
      }
    } else if (data.locale !== 'all') {
      if (accept(`${leafKey}\u0000${data.locale}`, NATIVE_ROW)) {
        target = target || {}
        target[data.locale] = extractValueFieldData(data)
      }
    } else {
      // Map read: the shared value fills each conversion locale that has no
      // locale row of its own (4.1).
      const source = options.sourceLocale
      const locales = options.conversionLocales ?? (source ? [source] : [])
      for (const locale of locales) {
        if (accept(`${leafKey}\u0000${locale}`, CONVERTED_ROW)) {
          target = target || {}
          target[locale] = extractValueFieldData(data)
        }
      }
    }
  } else if (data.locale === 'all') {
    if (accept(leafKey, NATIVE_ROW)) target = extractValueFieldData(data)
  } else if (data.locale === (options.sourceLocale ?? resolveLocale)) {
    // Now-shared field without a shared row: the source-locale row (4.2).
    if (accept(leafKey, CONVERTED_ROW)) target = extractValueFieldData(data)
  }

  return target
}

const restoreGroupFieldData = (
  field: GroupField,
  target: any,
  data: FlattenedFieldValue,
  pathIndex: number,
  ctx: RestoreContext
): any => {
  const { warnings } = ctx
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
  target[fieldName] = restoreFieldData(subField, target[fieldName], data, pathIndex + 1, ctx)
  return target
}

const restoreArrayFieldData = (
  field: ArrayField,
  target: any,
  data: FlattenedFieldValue,
  pathIndex: number,
  ctx: RestoreContext
): any => {
  const { warnings } = ctx
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
    ctx
  )
  return target
}

const restoreBlocksFieldData = (
  field: BlocksField,
  target: any,
  data: FlattenedFieldValue,
  pathIndex: number,
  ctx: RestoreContext
): any => {
  const { warnings, unavailableByArray } = ctx
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
    target = target || []
    let issues = unavailableByArray.get(target)
    if (!issues) {
      issues = new Map()
      unavailableByArray.set(target, issues)
    }
    const issue = issues.get(arrayIndex) ?? { storedIndex: arrayIndex, blockType }
    if (data.field_type === 'meta' && pathIndex + 2 === data.field_path.length) {
      issue.id = data.item_id
    }
    issues.set(arrayIndex, issue)
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
    ctx
  )
  return target
}

const restoreMultiRelationFieldData = (
  target: any,
  data: FlattenedFieldValue,
  pathIndex: number,
  warnings: string[]
): any => {
  // Path shape: `[...prefix, <field>, <index>]`. At `pathIndex` we have the
  // ordered position; the row itself is a single relation value.
  const arrayIndex = Number.parseInt(data.field_path[pathIndex] ?? '', 10)
  if (Number.isNaN(arrayIndex) || arrayIndex < 0) {
    warnings.push(
      `Invalid relation index '${data.field_path[pathIndex]}' in path ${data.field_path.join('.')}`
    )
    return target
  }

  if (data.field_type !== 'relation') {
    warnings.push(
      `Expected relation row for hasMany relation but got ${data.field_type} at path ${data.field_path.join('.')}`
    )
    return target
  }

  target = target || []
  target[arrayIndex] = extractValueFieldData(data)
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
        // Content identity is omitted, never null or '', when unknown. The
        // validator is restored only as a complete pair.
        ...(data.file_hash ? { fileHash: data.file_hash } : {}),
        ...(data.storage_validator_kind && data.storage_validator_value
          ? {
              storageValidator: {
                kind: data.storage_validator_kind,
                value: data.storage_validator_value,
              },
            }
          : {}),
        imageWidth: data.image_width,
        imageHeight: data.image_height,
        imageFormat: data.image_format,
        processingStatus: data.processing_status,
        thumbnailGenerated: data.thumbnail_generated,
        variants: data.variants?.map((variant) => ({
          name: variant.name,
          storagePath: variant.storage_path,
          storageUrl: variant.storage_url,
          width: variant.width,
          height: variant.height,
          format: variant.format,
        })),
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
        file_size: Number(unifiedValue.file_size),
        storage_provider: unifiedValue.storage_provider as string,
        storage_path: unifiedValue.storage_path as string,
        storage_url: orUndefined(unifiedValue.storage_url),
        file_hash: orUndefined(unifiedValue.file_hash),
        storage_validator_kind: orUndefined(unifiedValue.storage_validator_kind),
        storage_validator_value: orUndefined(unifiedValue.storage_validator_value),
        image_width: orUndefined(unifiedValue.image_width),
        image_height: orUndefined(unifiedValue.image_height),
        image_format: orUndefined(unifiedValue.image_format),
        processing_status: orUndefined(unifiedValue.processing_status),
        thumbnail_generated: orUndefined(unifiedValue.thumbnail_generated),
        variants: orUndefined(unifiedValue.variants),
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
