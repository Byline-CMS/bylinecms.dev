/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// Default content locales used when none are provided explicitly via config.
// Kept as a fallback so existing call sites don't break.
const DEFAULT_CONTENT_LOCALES = ['en', 'es', 'fr']

import type {
  ArrayField,
  BlocksField,
  CollectionDefinition,
  DateTimeStore,
  Field,
  FileStore,
  FlattenedStore,
  GroupField,
  NumericStore,
  RelationStore,
  ValueField,
} from '@byline/core'

export const getFirstOrThrow =
  <T>(message: string) =>
  (values: T[]): T => {
    const value = values[0]
    if (value == null) {
      throw new Error(message)
    }
    return value
  }

export function flattenFields(
  documentData: any,
  collectionConfig: CollectionDefinition,
  locale = 'all',
  contentLocales: string[] = DEFAULT_CONTENT_LOCALES
): FlattenedStore[] {
  const flattenedFields: FlattenedStore[] = []

  function getParentPath(path: string): string | undefined {
    const parts = path.split('.')
    if (parts.length <= 1) return undefined
    parts.pop()
    return parts.join('.')
  }

  function flatten(obj: any, fieldConfigs: Field[], basePath = '') {
    for (const fieldConfig of fieldConfigs) {
      const currentPath = basePath ? `${basePath}.${fieldConfig.name}` : fieldConfig.name
      const value = obj[fieldConfig.name]

      if (value === undefined || value === null) continue

      if ((fieldConfig.type === 'array' || fieldConfig.type === 'blocks') && Array.isArray(value)) {
        const containerField = fieldConfig as ArrayField | BlocksField
        value.forEach((item, index) => {
          const arrayElementPath = `${currentPath}.${index}`

          if (typeof item === 'object' && item !== null && containerField.fields) {
            // Blocks container + group shape support.
            // For the Docs collection, `content` is a blocks field whose
            // items are group fields like richTextBlock and photoBlock.
            if (item.type === 'group' && typeof item.name === 'string') {
              const blockName = item.name
              const blockFieldsArray = Array.isArray(item.fields) ? item.fields : []
              const blockFieldConfig = containerField.fields.find((f) => f.name === blockName)

              if (
                blockFieldConfig &&
                blockFieldConfig.type === 'group' &&
                Array.isArray(blockFieldConfig.fields)
              ) {
                blockFieldsArray.forEach((subItem: any, idx: number) => {
                  if (subItem && typeof subItem === 'object') {
                    const fieldName = Object.keys(subItem)[0]
                    if (fieldName != null) {
                      const fieldValue = subItem[fieldName]
                      const subField = blockFieldConfig.fields.find((f) => f.name === fieldName)
                      if (subField) {
                        const blockElementPath = `${arrayElementPath}.${blockName}.${idx}`
                        flatten({ [fieldName]: fieldValue }, [subField], blockElementPath)
                      }
                    }
                  }
                })
              }
            } else {
              // Legacy / generic array item shape: { fieldName: value }
              // Skip `_id` — it's a stable identity injected during read by
              // attachMetaToDocument and is not a real data field.
              const fieldName = Object.keys(item).find((k) => k !== '_id')
              if (fieldName != null) {
                const fieldValue = item[fieldName]
                const subField = containerField.fields.find((f) => f.name === fieldName)
                if (subField) {
                  if (
                    subField.type === 'group' &&
                    Array.isArray(fieldValue) &&
                    Array.isArray(subField.fields)
                  ) {
                    // Legacy block/group shape: { blockName: [ {field: val}, ... ] }
                    // Iterate each sub-item and flatten using the composite's child fields.
                    fieldValue.forEach((subItem: any, idx: number) => {
                      if (subItem && typeof subItem === 'object') {
                        const subFieldName = Object.keys(subItem).find((k) => k !== '_id')
                        if (subFieldName != null) {
                          const subFieldValue = subItem[subFieldName]
                          const childField = subField.fields.find(
                            (f: Field) => f.name === subFieldName
                          )
                          if (childField) {
                            const compositePath = `${arrayElementPath}.${fieldName}.${idx}`
                            flatten({ [subFieldName]: subFieldValue }, [childField], compositePath)
                          }
                        }
                      }
                    })
                  } else {
                    flatten({ [fieldName]: fieldValue }, [subField], arrayElementPath)
                  }
                }
              }
            }
          }
        })
      } else if (fieldConfig.localized && typeof value === 'object' && !Array.isArray(value)) {
        const valueKeys = Object.keys(value)

        // NOTE: This is potentially a valuable feature, as it would allow us to handle the updating
        // or migration of documents that have been retrieved via the 'all' locale. In other words,
        // if a document has been retrieved with the 'all' locale, it will have all locales present
        // for localized fields, and we can submit the document as such during migration, instead
        // of having to iterate over each locale and insert portions of a localized document separately.
        const isLocalizedObject =
          valueKeys.length > 0 && valueKeys.every((key) => contentLocales.includes(key))

        if (isLocalizedObject) {
          for (const [localeKey, localizedValue] of Object.entries(value)) {
            if (localizedValue !== undefined && localizedValue !== null) {
              flattenedFields.push(
                createFlattenedStore(
                  currentPath,
                  fieldConfig.name,
                  fieldConfig.type as ValueField['type'],
                  localizedValue,
                  localeKey,
                  getParentPath(currentPath)
                )
              )
            }
          }
        } else {
          // Not a localized object, treat as a regular field.
          flattenedFields.push(
            createFlattenedStore(
              currentPath,
              fieldConfig.name,
              fieldConfig.type as ValueField['type'],
              value,
              locale,
              getParentPath(currentPath)
            )
          )
        }
      } else if (
        fieldConfig.type === 'group' &&
        Array.isArray(value) &&
        Array.isArray((fieldConfig as GroupField).fields)
      ) {
        // Top-level group field: value is an array of single-key objects,
        // e.g. availableLanguages: [{ en: true }, { fr: false }, ...]
        // Recurse into each child value using its position index as the path segment.
        ;(value as any[]).forEach((subItem: any, idx: number) => {
          if (subItem && typeof subItem === 'object') {
            const subFieldName = Object.keys(subItem).find((k) => k !== '_id')
            if (subFieldName != null) {
              const subFieldValue = subItem[subFieldName]
              const childField = (fieldConfig as GroupField).fields.find(
                (f: Field) => f.name === subFieldName
              )
              if (childField) {
                flatten({ [subFieldName]: subFieldValue }, [childField], `${currentPath}.${idx}`)
              }
            }
          }
        })
      } else if (fieldConfig.type !== 'group') {
        // Only value-bearing field types are flattened directly. Structure
        // fields like group fields are containers and should delegate to their
        // nested value fields instead of being stored themselves.
        //
        // Non-localized fields are always stored with locale = 'all' so they
        // are returned for every content-locale request. Localized fields
        // use the caller-supplied locale (e.g. 'en', 'fr').
        const effectiveLocale = (fieldConfig as any).localized === true ? locale : 'all'
        flattenedFields.push(
          createFlattenedStore(
            currentPath,
            fieldConfig.name,
            fieldConfig.type as ValueField['type'],
            value,
            effectiveLocale,
            getParentPath(currentPath)
          )
        )
      }
    }
  }

  flatten(documentData, collectionConfig.fields)
  return flattenedFields
}

function createFlattenedStore(
  field_path: string,
  field_name: string,
  field_type: ValueField['type'],
  value: any,
  locale: string,
  parent_path?: string
): FlattenedStore {
  const baseValue = {
    field_path,
    field_name,
    locale,
    parent_path,
  }

  switch (field_type) {
    case 'text':
    case 'textArea':
    case 'boolean':
    case 'checkbox':
    case 'select':
      return { ...baseValue, field_type, value }

    case 'richText':
      return { ...baseValue, field_type, value }

    case 'float':
    case 'integer':
    case 'decimal': {
      return {
        ...baseValue,
        field_type,
        number_type: field_type,
        value_float: field_type === 'float' ? value : undefined,
        value_decimal: field_type === 'decimal' ? value : undefined,
        value_integer: field_type === 'integer' ? value : undefined,
      }
    }

    case 'time':
    case 'date':
    case 'datetime': {
      return {
        ...baseValue,
        field_type,
        date_type: field_type,
        value_time: field_type === 'time' ? value : undefined,
        value_date: field_type === 'date' ? value : undefined,
        value_timestamp_tz: field_type === 'datetime' ? value : undefined,
      }
    }

    case 'file':
    case 'image': {
      const v = value as FileStore
      return {
        ...baseValue,
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

    case 'relation':
      return { ...baseValue, field_type, ...value }

    case 'json':
    case 'object':
      return {
        ...baseValue,
        field_type,
        value: value.value,
        json_schema: value.json_schema,
        object_keys: value.object_keys, // Assuming object_keys is part of the value;
      }
    default:
      throw new Error(`Unsupported field type: ${field_type}`)
  }
}

export function reconstructFields(fieldValues: FlattenedStore[], locale = 'all'): any {
  const document: any = {}

  const setValue = (obj: any, path: string, value: any) => {
    const keys = path.split('.')
    let current = obj
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i]
      const nextKey = keys[i + 1]
      const isNextKeyIndex = nextKey !== undefined && !Number.isNaN(Number.parseInt(nextKey, 10))

      if (isNextKeyIndex) {
        if (key && (!current[key] || !Array.isArray(current[key]))) {
          current[key] = []
        }
      } else if (key && (!current[key] || typeof current[key] !== 'object')) {
        if (
          Array.isArray(current) &&
          typeof key === 'string' &&
          !Number.isNaN(Number.parseInt(key, 10))
        ) {
          const index = Number.parseInt(key, 10)
          if (!current[index]) {
            current[index] = {}
          }
        } else {
          current[key] = {}
        }
      }
      if (key) {
        current = current[key]
      }
    }
    const lastKey = keys[keys.length - 1]
    if (lastKey !== undefined) {
      if (
        Array.isArray(current) &&
        typeof lastKey === 'string' &&
        !Number.isNaN(Number.parseInt(lastKey, 10))
      ) {
        const index = Number.parseInt(lastKey, 10)
        if (current[index] && typeof current[index] === 'object') {
          Object.assign(current[index], value)
        } else {
          current[index] = value
        }
      } else {
        current[lastKey] = value
      }
    }
  }

  const fieldValuesByPath: Record<string, FlattenedStore[]> = {}
  for (const fv of fieldValues) {
    if (!fieldValuesByPath[fv.field_path]) {
      fieldValuesByPath[fv.field_path] = []
    }
    fieldValuesByPath[fv.field_path]?.push(fv)
  }

  for (const path in fieldValuesByPath) {
    const values = fieldValuesByPath[path]
    if (!values) continue
    const preferredValue =
      values.find((v) => v.locale === locale) ||
      values.find((v) => v.locale === 'default') ||
      values[0]

    if (values.length > 1 && values.some((v) => v.locale !== 'all')) {
      // Localized
      const localizedObject: Record<string, any> = {}
      values.forEach((v) => {
        localizedObject[v.locale] = createReconstructedValue(v)
      })
      setValue(document, path, localizedObject)
    } else if (preferredValue) {
      const valueToSet = createReconstructedValue(preferredValue)
      setValue(document, path, valueToSet)
    }
  }

  return document
}

function createReconstructedValue(fieldValue: FlattenedStore): any {
  switch (fieldValue.field_type) {
    case 'text':
    case 'textArea':
    case 'select':
    case 'richText':
    case 'checkbox':
    case 'boolean':
    case 'json':
    case 'object':
      return (fieldValue as any).value

    case 'float':
    case 'integer':
    case 'decimal': {
      const value = fieldValue as NumericStore
      if (fieldValue.field_type === 'float') {
        return value.value_float
      }
      if (fieldValue.field_type === 'integer') {
        return fieldValue.value_integer
      }
      if (fieldValue.field_type === 'decimal') {
        return fieldValue.value_decimal
      }
      return undefined
    }

    case 'time':
    case 'date':
    case 'datetime': {
      const value = fieldValue as DateTimeStore
      if (value.date_type === 'time') {
        return value.value_time
      }
      if (value.date_type === 'date') {
        return value.value_date
      }
      // Assuming timestamp_tz is the default for datetime
      if (value.date_type === 'datetime') {
        return value.value_timestamp_tz
      }
      return undefined
    }

    case 'file':
    case 'image': {
      const fileValue = fieldValue as FileStore
      return {
        file_id: fileValue.file_id,
        filename: fileValue.filename,
        original_filename: fileValue.original_filename,
        mime_type: fileValue.mime_type,
        file_size: fileValue.file_size,
        storage_provider: fileValue.storage_provider,
        storage_path: fileValue.storage_path,
        storage_url: fileValue.storage_url,
        file_hash: fileValue.file_hash,
        image_width: fileValue.image_width,
        image_height: fileValue.image_height,
        image_format: fileValue.image_format,
        processing_status: fileValue.processing_status,
        thumbnail_generated: fileValue.thumbnail_generated,
      }
    }

    case 'relation': {
      const relationValue = fieldValue as RelationStore
      return {
        target_document_id: relationValue.target_document_id,
        target_collection_id: relationValue.target_collection_id,
        relationship_type: relationValue.relationship_type,
        cascade_delete: relationValue.cascade_delete,
      }
    }

    default:
      return (fieldValue as any).value
  }
}
