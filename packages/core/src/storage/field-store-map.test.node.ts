/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import {
  ALL_STORE_TYPES,
  fieldTypeToStore,
  fieldTypeToStoreType,
  type StoreType,
} from './field-store-map.js'

// ---------------------------------------------------------------------------
// Canonical field type inventory
// ---------------------------------------------------------------------------

/**
 * Every value-bearing field type the schema supports. If a new field type is
 * added in `@types/field-types.ts`, add it here too — the contract tests
 * below will then fail until the mapping picks it up.
 */
const VALUE_FIELD_TYPES = [
  'text',
  'textArea',
  'select',
  'integer',
  'float',
  'decimal',
  'boolean',
  'checkbox',
  'date',
  'time',
  'datetime',
  'richText',
  'json',
  'object',
  'file',
  'image',
  'relation',
] as const

const STRUCTURE_FIELD_TYPES = ['group', 'array', 'blocks'] as const

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ALL_STORE_TYPES', () => {
  it('lists exactly the seven EAV store table types', () => {
    expect([...ALL_STORE_TYPES]).toEqual([
      'text',
      'numeric',
      'boolean',
      'datetime',
      'json',
      'relation',
      'file',
    ])
  })

  it('contains no duplicates', () => {
    expect(new Set(ALL_STORE_TYPES).size).toBe(ALL_STORE_TYPES.length)
  })
})

describe('fieldTypeToStore', () => {
  it('covers every value-bearing field type', () => {
    const missing = VALUE_FIELD_TYPES.filter((t) => fieldTypeToStore[t] === undefined)
    expect(missing).toEqual([])
  })

  it('never maps a structure field type', () => {
    for (const t of STRUCTURE_FIELD_TYPES) {
      expect(fieldTypeToStore[t]).toBeUndefined()
    }
  })

  it('only references declared store types', () => {
    const valid = new Set<StoreType>(ALL_STORE_TYPES)
    for (const [fieldType, mapping] of Object.entries(fieldTypeToStore)) {
      if (!mapping) continue
      expect(valid.has(mapping.storeType), `field '${fieldType}' → '${mapping.storeType}'`).toBe(
        true
      )
    }
  })

  it('assigns a non-empty valueColumn for every mapping', () => {
    for (const [fieldType, mapping] of Object.entries(fieldTypeToStore)) {
      if (!mapping) continue
      expect(mapping.valueColumn.length, `field '${fieldType}'`).toBeGreaterThan(0)
    }
  })

  it('uses at least one entry for each store type', () => {
    const usedStores = new Set<string>()
    for (const mapping of Object.values(fieldTypeToStore)) {
      if (mapping) usedStores.add(mapping.storeType)
    }
    for (const storeType of ALL_STORE_TYPES) {
      expect(usedStores.has(storeType), `store '${storeType}' has no field types`).toBe(true)
    }
  })
})

describe('fieldTypeToStoreType', () => {
  it('agrees with fieldTypeToStore for every value-bearing type', () => {
    for (const t of VALUE_FIELD_TYPES) {
      const rich = fieldTypeToStore[t]
      const kind = fieldTypeToStoreType[t]
      expect(rich).toBeDefined()
      expect(kind, `field '${t}' storeKind vs storeType`).toBe(rich?.storeType)
    }
  })

  it('maps structure fields array/blocks to "meta"', () => {
    expect(fieldTypeToStoreType.array).toBe('meta')
    expect(fieldTypeToStoreType.blocks).toBe('meta')
  })

  it('maps the group structure field to undefined', () => {
    expect(fieldTypeToStoreType.group).toBeUndefined()
  })

  it('covers every declared field type (value + structure)', () => {
    const allKnown = [...VALUE_FIELD_TYPES, ...STRUCTURE_FIELD_TYPES]
    for (const t of allKnown) {
      // `group` is intentionally undefined, so check by key presence rather than truthiness.
      expect(t in fieldTypeToStoreType, `missing field type '${t}'`).toBe(true)
    }
  })
})
