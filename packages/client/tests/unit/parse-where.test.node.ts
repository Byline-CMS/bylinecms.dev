/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { defineCollection, defineWorkflow } from '@byline/core'
import { describe, expect, it } from 'vitest'

import { hasFieldLevelConditions, parseSort, parseWhere } from '../../src/query/parse-where.js'

const testCollection = defineCollection({
  path: 'test-articles',
  labels: { singular: 'Article', plural: 'Articles' },
  workflow: defineWorkflow({
    draft: { label: 'Draft', verb: 'Revert to Draft' },
    published: { label: 'Published', verb: 'Publish' },
  }),
  fields: [
    { name: 'title', type: 'text', label: 'Title', localized: true },
    { name: 'summary', type: 'textArea', label: 'Summary', localized: true },
    { name: 'views', type: 'integer', label: 'Views', optional: true },
    { name: 'rating', type: 'float', label: 'Rating', optional: true },
    { name: 'featured', type: 'checkbox', label: 'Featured', optional: true },
    { name: 'published_at', type: 'datetime', label: 'Published At', optional: true },
  ],
})

// ---------------------------------------------------------------------------
// parseWhere
// ---------------------------------------------------------------------------

describe('parseWhere', () => {
  it('should return empty result for undefined where', () => {
    const result = parseWhere(undefined, testCollection)
    expect(result.fieldFilters).toEqual([])
    expect(result.status).toBeUndefined()
    expect(result.query).toBeUndefined()
    expect(result.pathFilter).toBeUndefined()
  })

  it('should extract status as a document-level condition', () => {
    const result = parseWhere({ status: 'published' }, testCollection)
    expect(result.status).toBe('published')
    expect(result.fieldFilters).toEqual([])
  })

  it('should extract query as a document-level condition', () => {
    const result = parseWhere({ query: 'search term' }, testCollection)
    expect(result.query).toBe('search term')
    expect(result.fieldFilters).toEqual([])
  })

  it('should extract path with bare value as a document-level $eq filter', () => {
    const result = parseWhere({ path: 'hello-world' }, testCollection)
    expect(result.pathFilter).toEqual({ operator: '$eq', value: 'hello-world' })
    expect(result.fieldFilters).toEqual([])
  })

  it('should extract path with $contains operator', () => {
    const result = parseWhere({ path: { $contains: 'news' } }, testCollection)
    expect(result.pathFilter).toEqual({ operator: '$contains', value: 'news' })
  })

  it('should normalise bare value to $eq for text fields', () => {
    const result = parseWhere({ title: 'Hello' }, testCollection)
    expect(result.fieldFilters).toHaveLength(1)
    expect(result.fieldFilters[0]).toEqual({
      fieldName: 'title',
      storeType: 'text',
      valueColumn: 'value',
      operator: '$eq',
      value: 'Hello',
    })
  })

  it('should resolve $contains on a text field', () => {
    const result = parseWhere({ title: { $contains: 'launch' } }, testCollection)
    expect(result.fieldFilters).toHaveLength(1)
    expect(result.fieldFilters[0]).toEqual({
      fieldName: 'title',
      storeType: 'text',
      valueColumn: 'value',
      operator: '$contains',
      value: 'launch',
    })
  })

  it('should resolve integer fields to numeric store with value_integer column', () => {
    const result = parseWhere({ views: { $gte: 100 } }, testCollection)
    expect(result.fieldFilters).toHaveLength(1)
    expect(result.fieldFilters[0]).toEqual({
      fieldName: 'views',
      storeType: 'numeric',
      valueColumn: 'value_integer',
      operator: '$gte',
      value: 100,
    })
  })

  it('should resolve float fields to numeric store with value_float column', () => {
    const result = parseWhere({ rating: { $gt: 4.5 } }, testCollection)
    expect(result.fieldFilters).toHaveLength(1)
    expect(result.fieldFilters[0]).toEqual({
      fieldName: 'rating',
      storeType: 'numeric',
      valueColumn: 'value_float',
      operator: '$gt',
      value: 4.5,
    })
  })

  it('should resolve checkbox fields to boolean store', () => {
    const result = parseWhere({ featured: true }, testCollection)
    expect(result.fieldFilters).toHaveLength(1)
    expect(result.fieldFilters[0]).toEqual({
      fieldName: 'featured',
      storeType: 'boolean',
      valueColumn: 'value',
      operator: '$eq',
      value: true,
    })
  })

  it('should resolve datetime fields to datetime store', () => {
    const result = parseWhere({ published_at: { $gte: '2026-01-01T00:00:00Z' } }, testCollection)
    expect(result.fieldFilters).toHaveLength(1)
    expect(result.fieldFilters[0]).toEqual({
      fieldName: 'published_at',
      storeType: 'datetime',
      valueColumn: 'value_timestamp_tz',
      operator: '$gte',
      value: '2026-01-01T00:00:00Z',
    })
  })

  it('should handle $in operator', () => {
    const result = parseWhere({ title: { $in: ['Hello', 'World'] } }, testCollection)
    expect(result.fieldFilters[0]).toEqual({
      fieldName: 'title',
      storeType: 'text',
      valueColumn: 'value',
      operator: '$in',
      value: ['Hello', 'World'],
    })
  })

  it('should handle mixed document-level and field-level conditions', () => {
    const result = parseWhere(
      {
        status: 'published',
        query: 'search',
        title: { $contains: 'launch' },
        views: { $gte: 50 },
      },
      testCollection
    )

    expect(result.status).toBe('published')
    expect(result.query).toBe('search')
    expect(result.fieldFilters).toHaveLength(2)
    expect(result.fieldFilters.map((f) => f.fieldName).sort()).toEqual(['title', 'views'])
  })

  it('should skip unknown field names silently', () => {
    const result = parseWhere({ nonexistent: 'value' }, testCollection)
    expect(result.fieldFilters).toEqual([])
  })

  it('should handle null values', () => {
    const result = parseWhere({ title: null }, testCollection)
    expect(result.fieldFilters).toHaveLength(1)
    expect(result.fieldFilters[0]?.operator).toBe('$eq')
    expect(result.fieldFilters[0]?.value).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// hasFieldLevelConditions
// ---------------------------------------------------------------------------

describe('hasFieldLevelConditions', () => {
  it('should return false for document-level only conditions', () => {
    const parsed = parseWhere({ status: 'draft', query: 'test' }, testCollection)
    expect(hasFieldLevelConditions(parsed)).toBe(false)
  })

  it('should return true when field filters are present', () => {
    const parsed = parseWhere({ title: { $contains: 'hello' } }, testCollection)
    expect(hasFieldLevelConditions(parsed)).toBe(true)
  })

  it('should return true when path filter is present', () => {
    const parsed = parseWhere({ path: { $contains: 'news' } }, testCollection)
    expect(hasFieldLevelConditions(parsed)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// parseSort
// ---------------------------------------------------------------------------

describe('parseSort', () => {
  it('should default to created_at desc when no sort provided', () => {
    const result = parseSort(undefined, testCollection)
    expect(result.orderBy).toBe('created_at')
    expect(result.orderDirection).toBe('desc')
    expect(result.fieldSort).toBeUndefined()
  })

  it('should default to created_at desc for empty object', () => {
    const result = parseSort({}, testCollection)
    expect(result.orderBy).toBe('created_at')
    expect(result.orderDirection).toBe('desc')
  })

  it('should map camelCase createdAt to document-level column', () => {
    const result = parseSort({ createdAt: 'asc' }, testCollection)
    expect(result.orderBy).toBe('created_at')
    expect(result.orderDirection).toBe('asc')
    expect(result.fieldSort).toBeUndefined()
  })

  it('should return field sort for a text field', () => {
    const result = parseSort({ title: 'asc' }, testCollection)
    expect(result.fieldSort).toEqual({
      fieldName: 'title',
      storeType: 'text',
      valueColumn: 'value',
      direction: 'asc',
    })
    expect(result.orderBy).toBeUndefined()
  })

  it('should return field sort for a numeric field', () => {
    const result = parseSort({ views: 'desc' }, testCollection)
    expect(result.fieldSort).toEqual({
      fieldName: 'views',
      storeType: 'numeric',
      valueColumn: 'value_integer',
      direction: 'desc',
    })
  })

  it('should fall back to created_at for unknown field name', () => {
    const result = parseSort({ nonexistent: 'asc' }, testCollection)
    expect(result.orderBy).toBe('created_at')
    expect(result.orderDirection).toBe('desc')
    expect(result.fieldSort).toBeUndefined()
  })
})
