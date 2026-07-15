/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { ERR_VALIDATION } from '../lib/errors.js'
import { walkFieldTree } from './walk-field-tree.js'
import type { FieldSet } from '../@types/index.js'

export type CanonicalNumericFieldType = 'integer' | 'float' | 'decimal'
export type CanonicalNumericValue = number | string

const NUMERIC_LITERAL_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

/** Return whether a value already has the storage-facing canonical type and shape. */
export function isCanonicalNumericValue(
  fieldType: CanonicalNumericFieldType,
  value: unknown
): value is CanonicalNumericValue {
  if (fieldType === 'decimal') {
    return typeof value === 'string' && value.trim() === value && NUMERIC_LITERAL_RE.test(value)
  }
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (fieldType !== 'integer' || Number.isInteger(value))
  )
}

/**
 * Convert a tolerant numeric write value to its canonical representation.
 * `undefined` means the value was empty and should be removed.
 */
export function normalizeNumericValue(
  fieldType: CanonicalNumericFieldType,
  value: unknown,
  path: string
): CanonicalNumericValue | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return undefined
    if (!NUMERIC_LITERAL_RE.test(trimmed)) throwNumericValidation(fieldType, value, path)
    if (fieldType === 'decimal') return trimmed
    const numberValue = Number(trimmed)
    if (!Number.isFinite(numberValue)) throwNumericValidation(fieldType, value, path)
    if (fieldType === 'integer' && !Number.isInteger(numberValue)) {
      throwNumericValidation(fieldType, value, path)
    }
    return numberValue
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throwNumericValidation(fieldType, value, path)
    if (fieldType === 'integer' && !Number.isInteger(value)) {
      throwNumericValidation(fieldType, value, path)
    }
    return fieldType === 'decimal' ? String(value) : value
  }

  throwNumericValidation(fieldType, value, path)
}

/**
 * Normalize every user-writable numeric leaf in a schema-shaped data tree.
 * Mutates `data` in place. Counter fields are deliberately excluded because
 * their values are supplied by the lifecycle allocator.
 */
export function normalizeNumericFields(fields: FieldSet, data: Record<string, any>): void {
  for (const leaf of walkFieldTree(fields, data)) {
    if (!isWritableNumericType(leaf.field.type)) continue

    if ((leaf.field as { localized?: boolean }).localized === true && isLocaleMap(leaf.value)) {
      for (const [locale, localeValue] of Object.entries(leaf.value)) {
        normalizeLeafValue(
          leaf.field.type,
          leaf.value,
          locale,
          localeValue,
          `${leaf.fieldPath}.${locale}`
        )
      }
      continue
    }

    normalizeLeafValue(leaf.field.type, leaf.parent, leaf.key, leaf.value, leaf.fieldPath)
  }
}

function normalizeLeafValue(
  fieldType: CanonicalNumericFieldType,
  parent: Record<string, any>,
  key: string,
  value: unknown,
  path: string
): void {
  const normalized = normalizeNumericValue(fieldType, value, path)
  if (normalized === undefined) {
    delete parent[key]
  } else {
    parent[key] = normalized
  }
}

function isWritableNumericType(type: string): type is CanonicalNumericFieldType {
  return type === 'integer' || type === 'float' || type === 'decimal'
}

function isLocaleMap(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function throwNumericValidation(
  fieldType: CanonicalNumericFieldType,
  value: unknown,
  path: string
): never {
  throw ERR_VALIDATION({
    message: `invalid ${fieldType} value at '${path}'`,
    details: { path, fieldType, value },
  })
}
