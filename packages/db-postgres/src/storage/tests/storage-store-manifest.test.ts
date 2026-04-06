/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  allStoreTypes,
  buildSelectList,
  columns,
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
    it('UNIFIED_COLUMN_COUNT matches manifest', () => {
      // columns array has all columns except field_type, which is added during generation
      assert.strictEqual(UNIFIED_COLUMN_COUNT, columns.length + 1)
    })

    for (const storeType of allStoreTypes) {
      it(`${storeType} SELECT list has ${UNIFIED_COLUMN_COUNT} columns`, () => {
        const selectList = buildSelectList(storeType)
        const cols = parseColumns(selectList)
        assert.strictEqual(
          cols.length,
          UNIFIED_COLUMN_COUNT,
          `Expected ${UNIFIED_COLUMN_COUNT} columns for ${storeType}, got ${cols.length}:\n${cols.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}`
        )
      })
    }
  })

  describe('column order consistency', () => {
    it('all store types produce the same column aliases in the same order', () => {
      const referenceAliases = parseColumns(buildSelectList('text')).map(extractAlias)

      for (const storeType of allStoreTypes) {
        if (storeType === 'text') continue
        const aliases = parseColumns(buildSelectList(storeType)).map(extractAlias)
        assert.deepStrictEqual(
          aliases,
          referenceAliases,
          `Column order mismatch between text and ${storeType}`
        )
      }
    })
  })

  describe('field_type literals', () => {
    it('each store type emits the correct field_type literal', () => {
      for (const storeType of allStoreTypes) {
        const selectList = buildSelectList(storeType)
        const expected = fieldTypeLiterals[storeType]
        assert.ok(
          selectList.includes(`'${expected}' as "field_type"`),
          `Expected field_type '${expected}' for ${storeType}`
        )
      }
    })
  })

  describe('field_type position', () => {
    it('field_type is the 4th column (index 3) for all store types', () => {
      for (const storeType of allStoreTypes) {
        const cols = parseColumns(buildSelectList(storeType))
        const fieldTypeCol = cols[3]
        assert.ok(
          fieldTypeCol?.includes('field_type'),
          `Expected field_type at index 3 for ${storeType}, got: ${fieldTypeCol}`
        )
      }
    })
  })

  describe('source columns', () => {
    it('text store maps value → text_value', () => {
      const cols = parseColumns(buildSelectList('text'))
      const textValueCol = cols.find((c) => c.includes('text_value'))
      assert.ok(textValueCol, 'text_value column not found')
      assert.ok(
        textValueCol.includes('value as "text_value"'),
        `Expected 'value as "text_value"', got: ${textValueCol}`
      )
    })

    it('boolean store maps value → boolean_value', () => {
      const cols = parseColumns(buildSelectList('boolean'))
      const boolCol = cols.find((c) => c.includes('boolean_value'))
      assert.ok(boolCol, 'boolean_value column not found')
      assert.ok(
        boolCol.includes('value as "boolean_value"'),
        `Expected 'value as "boolean_value"', got: ${boolCol}`
      )
    })

    it('numeric store includes number_type, value_integer, value_decimal, value_float', () => {
      const cols = parseColumns(buildSelectList('numeric'))
      const colText = cols.join(' ')
      for (const field of ['number_type', 'value_integer', 'value_decimal', 'value_float']) {
        assert.ok(colText.includes(field), `Expected ${field} in numeric SELECT list`)
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
        assert.ok(colText.includes(field), `Expected ${field} in file SELECT list`)
      }
    })

    it('non-owning stores emit NULL for type-specific columns', () => {
      const cols = parseColumns(buildSelectList('text'))
      const numericCol = cols.find((c) => c.includes('number_type'))
      assert.ok(numericCol, 'number_type column not found')
      assert.ok(
        numericCol.includes('NULL::varchar'),
        `Expected NULL for number_type in text store, got: ${numericCol}`
      )
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
          assert.ok(col, `Expected bare column '${baseName}' in ${storeType} SELECT list`)
        }
      }
    })
  })
})
