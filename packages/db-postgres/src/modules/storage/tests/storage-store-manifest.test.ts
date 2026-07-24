/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import {
  allStoreTypes,
  buildSelectList,
  fieldTypeLiterals,
  UNIFIED_COLUMN_COUNT,
} from '../storage-store-manifest.js'

/**
 * Parse a generated SELECT list into individual column expressions.
 * Splits on commas that are not inside parentheses (to handle casts like
 * NULL::decimal(10,2) if they ever appear).
 */
function parseColumns(selectList: string): string[] {
  return selectList
    .split(',\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * Extract the output alias from a column expression.
 * e.g. `value as "text_value"` → `text_value`
 *      `id` → `id`
 *      `NULL::boolean as "boolean_value"` → `boolean_value`
 */
function extractAlias(expr: string): string {
  const match = expr.match(/as\s+"([^"]+)"/)
  if (match) return match[1]!
  // No alias — the expression is just the column name
  return expr.replace(/^NULL::\S+/, '').trim() || expr
}

describe('storage-store-manifest', () => {
  describe('column count', () => {
    // Manifest data-level pins (column count/order, per-store sources
    // coverage) live in @byline/core's store-manifest.test.node.ts. This
    // suite only exercises this adapter's SQL generation off that manifest.
    for (const storeType of allStoreTypes) {
      it(`${storeType} SELECT list has ${UNIFIED_COLUMN_COUNT} columns`, () => {
        const selectList = buildSelectList(storeType)
        const cols = parseColumns(selectList)
        expect(
          cols.length,
          `Expected ${UNIFIED_COLUMN_COUNT} columns for ${storeType}, got ${cols.length}:\n${cols.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}`
        ).toBe(UNIFIED_COLUMN_COUNT)
      })
    }
  })

  describe('column order consistency', () => {
    it('all store types produce the same column aliases in the same order', () => {
      const referenceAliases = parseColumns(buildSelectList('text')).map(extractAlias)

      for (const storeType of allStoreTypes) {
        if (storeType === 'text') continue
        const aliases = parseColumns(buildSelectList(storeType)).map(extractAlias)
        expect(aliases, `Column order mismatch between text and ${storeType}`).toEqual(
          referenceAliases
        )
      }
    })
  })

  describe('field_type literals', () => {
    it('each store type emits the correct field_type literal', () => {
      for (const storeType of allStoreTypes) {
        const selectList = buildSelectList(storeType)
        const expected = fieldTypeLiterals[storeType]
        expect(
          selectList.includes(`'${expected}' as "field_type"`),
          `Expected field_type '${expected}' for ${storeType}`
        ).toBe(true)
      }
    })
  })

  describe('field_type position', () => {
    it('field_type is the 4th column (index 3) for all store types', () => {
      for (const storeType of allStoreTypes) {
        const cols = parseColumns(buildSelectList(storeType))
        const fieldTypeCol = cols[3]
        expect(
          fieldTypeCol?.includes('field_type'),
          `Expected field_type at index 3 for ${storeType}, got: ${fieldTypeCol}`
        ).toBe(true)
      }
    })
  })

  describe('source columns', () => {
    it('text store maps value → text_value', () => {
      const cols = parseColumns(buildSelectList('text'))
      const textValueCol = cols.find((c) => c.includes('text_value'))
      expect(textValueCol, 'text_value column not found').toBeTruthy()
      expect(
        textValueCol?.includes('value as "text_value"'),
        `Expected 'value as "text_value"', got: ${textValueCol}`
      ).toBe(true)
    })

    it('boolean store maps value → boolean_value', () => {
      const cols = parseColumns(buildSelectList('boolean'))
      const boolCol = cols.find((c) => c.includes('boolean_value'))
      expect(boolCol, 'boolean_value column not found').toBeTruthy()
      expect(
        boolCol?.includes('value as "boolean_value"'),
        `Expected 'value as "boolean_value"', got: ${boolCol}`
      ).toBe(true)
    })

    it('numeric store includes number_type, value_integer, value_decimal, value_float', () => {
      const cols = parseColumns(buildSelectList('numeric'))
      const colText = cols.join(' ')
      for (const field of ['number_type', 'value_integer', 'value_decimal', 'value_float']) {
        expect(colText.includes(field), `Expected ${field} in numeric SELECT list`).toBe(true)
      }
    })

    it('file store includes all file-specific columns', () => {
      const cols = parseColumns(buildSelectList('file'))
      const colText = cols.join(' ')
      for (const field of [
        'file_id',
        'filename',
        'original_filename',
        'mime_type',
        'file_size',
        'storage_provider',
        'storage_path',
      ]) {
        expect(colText.includes(field), `Expected ${field} in file SELECT list`).toBe(true)
      }
    })

    it('non-owning stores emit NULL for type-specific columns', () => {
      const cols = parseColumns(buildSelectList('text'))
      const numericCol = cols.find((c) => c.includes('number_type'))
      expect(numericCol, 'number_type column not found').toBeTruthy()
      expect(
        numericCol?.includes('NULL::varchar'),
        `Expected NULL for number_type in text store, got: ${numericCol}`
      ).toBe(true)
    })
  })

  describe('base columns', () => {
    it('base columns are emitted as bare column names (no cast, no alias)', () => {
      const baseNames = [
        'id',
        'document_version_id',
        'collection_id',
        'field_path',
        'field_name',
        'locale',
        'parent_path',
      ]
      for (const storeType of allStoreTypes) {
        const cols = parseColumns(buildSelectList(storeType))
        for (const baseName of baseNames) {
          const col = cols.find((c) => c.trim() === baseName)
          expect(col, `Expected bare column '${baseName}' in ${storeType} SELECT list`).toBeTruthy()
        }
      }
    })
  })
})
