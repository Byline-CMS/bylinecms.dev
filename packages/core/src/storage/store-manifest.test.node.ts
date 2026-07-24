/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { ALL_STORE_TYPES } from './field-store-map.js'
import { storeColumnManifest, storeTableNames } from './store-manifest.js'

/**
 * Data-level pins for the shared store-column manifest. SQL-generation
 * behaviour (buildSelectList, NULL casts, field_type literal placement) is
 * exercised by the Postgres adapter's own test — this file only pins the
 * dialect-independent manifest data every adapter consumes.
 */
describe('store-manifest', () => {
  it('pins the manifest column count', () => {
    expect(storeColumnManifest.length).toBe(39)
  })

  it('pins the manifest column order', () => {
    expect(storeColumnManifest.map((col) => col.name)).toEqual([
      'id',
      'document_version_id',
      'collection_id',
      'field_path',
      'field_name',
      'locale',
      'parent_path',
      'text_value',
      'boolean_value',
      'json_value',
      'date_type',
      'value_date',
      'value_time',
      'value_timestamp_tz',
      'file_id',
      'filename',
      'original_filename',
      'mime_type',
      'file_size',
      'storage_provider',
      'storage_path',
      'storage_url',
      'file_hash',
      'image_width',
      'image_height',
      'image_format',
      'processing_status',
      'thumbnail_generated',
      'variants',
      'target_document_id',
      'target_collection_id',
      'relationship_type',
      'cascade_delete',
      'json_schema',
      'object_keys',
      'number_type',
      'value_integer',
      'value_decimal',
      'value_float',
    ])
  })

  it('has a table name for every StoreType', () => {
    for (const storeType of ALL_STORE_TYPES) {
      expect(storeTableNames[storeType], `Missing table name for ${storeType}`).toBeTruthy()
    }
  })

  it('every StoreType has at least one sources entry for its value columns', () => {
    for (const storeType of ALL_STORE_TYPES) {
      const owned = storeColumnManifest.filter((col) => col.sources?.[storeType] != null)
      expect(
        owned.length,
        `Expected ${storeType} to own at least one manifest column`
      ).toBeGreaterThan(0)
    }
  })

  it('pins the exact set of columns each StoreType owns', () => {
    const ownedNames = (storeType: (typeof ALL_STORE_TYPES)[number]) =>
      storeColumnManifest.filter((col) => col.sources?.[storeType] != null).map((col) => col.name)

    expect(ownedNames('text')).toEqual(['text_value'])
    expect(ownedNames('boolean')).toEqual(['boolean_value'])
    expect(ownedNames('json')).toEqual(['json_value', 'json_schema', 'object_keys'])
    expect(ownedNames('datetime')).toEqual([
      'date_type',
      'value_date',
      'value_time',
      'value_timestamp_tz',
    ])
    expect(ownedNames('relation')).toEqual([
      'target_document_id',
      'target_collection_id',
      'relationship_type',
      'cascade_delete',
    ])
    expect(ownedNames('numeric')).toEqual([
      'number_type',
      'value_integer',
      'value_decimal',
      'value_float',
    ])
    expect(ownedNames('file')).toEqual([
      'file_id',
      'filename',
      'original_filename',
      'mime_type',
      'file_size',
      'storage_provider',
      'storage_path',
      'storage_url',
      'file_hash',
      'image_width',
      'image_height',
      'image_format',
      'processing_status',
      'thumbnail_generated',
      'variants',
    ])
  })

  it('base columns (no sources) are id, document_version_id, collection_id, field_path, field_name, locale, parent_path', () => {
    const baseNames = storeColumnManifest.filter((col) => !col.sources).map((col) => col.name)
    expect(baseNames).toEqual([
      'id',
      'document_version_id',
      'collection_id',
      'field_path',
      'field_name',
      'locale',
      'parent_path',
    ])
  })
})
