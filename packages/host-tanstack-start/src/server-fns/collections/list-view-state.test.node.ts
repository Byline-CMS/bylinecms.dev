/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { resolveListViewState, sortableFieldNames } from './list-view-state.js'

const base = {
  params: {},
  preference: null,
  orderable: false,
  sortableFields: ['title', 'summary', 'created_at', 'updated_at'],
  configuredSort: undefined,
}

describe('resolveListViewState', () => {
  it('defaults to page size 15 and no sort when nothing is set', () => {
    expect(resolveListViewState({ ...base })).toEqual({ pageSize: 15 })
  })

  it('lets explicit URL params win over preference and configured sort', () => {
    const result = resolveListViewState({
      ...base,
      params: { page_size: 15, order: 'title', desc: false },
      preference: { page_size: 100, order: 'summary', desc: true },
      configuredSort: { order: 'created_at', desc: true },
    })
    expect(result).toEqual({
      pageSize: 15,
      sort: { title: 'asc' },
      metaOrder: 'title',
      metaDesc: false,
    })
  })

  it('preserves the pre-existing "omitted desc means descending" param semantics', () => {
    const result = resolveListViewState({ ...base, params: { order: 'title' } })
    expect(result.sort).toEqual({ title: 'desc' })
    // meta passthrough stays exactly what the URL carried (undefined here).
    expect(result.metaOrder).toBe('title')
    expect(result.metaDesc).toBeUndefined()
  })

  it('applies the preference on a params-less landing', () => {
    const result = resolveListViewState({
      ...base,
      preference: { page_size: 50, order: 'title', desc: true },
    })
    expect(result).toEqual({
      pageSize: 50,
      sort: { title: 'desc' },
      metaOrder: 'title',
      metaDesc: true,
    })
  })

  it('skips a stale preference order and falls through to configuredSort', () => {
    const result = resolveListViewState({
      ...base,
      preference: { order: 'removed_field', desc: true },
      configuredSort: { order: 'created_at', desc: true },
    })
    expect(result.sort).toEqual({ created_at: 'desc' })
    expect(result.metaOrder).toBe('created_at')
  })

  it('ignores an out-of-range or non-integer preference page_size', () => {
    expect(resolveListViewState({ ...base, preference: { page_size: 0 } }).pageSize).toBe(15)
    expect(resolveListViewState({ ...base, preference: { page_size: 999 } }).pageSize).toBe(15)
    expect(resolveListViewState({ ...base, preference: { page_size: 12.5 } }).pageSize).toBe(15)
  })

  it('applies page_size but never sort preferences on orderable collections', () => {
    const result = resolveListViewState({
      ...base,
      orderable: true,
      preference: { page_size: 50, order: 'title', desc: true },
    })
    expect(result).toEqual({ pageSize: 50, sort: { order_key: 'asc' } })
  })

  it('still lets explicit params override the drag order on orderable collections', () => {
    const result = resolveListViewState({
      ...base,
      orderable: true,
      params: { order: 'title', desc: true },
    })
    expect(result.sort).toEqual({ title: 'desc' })
  })

  it('combines a page_size-only preference with configuredSort', () => {
    const result = resolveListViewState({
      ...base,
      preference: { page_size: 30 },
      configuredSort: { order: 'created_at', desc: true },
    })
    expect(result).toEqual({
      pageSize: 30,
      sort: { created_at: 'desc' },
      metaOrder: 'created_at',
      metaDesc: true,
    })
  })
})

describe('sortableFieldNames', () => {
  it('keeps scalar-store fields plus system columns; drops structure, json, file, and relation fields', () => {
    const fields = [
      { name: 'title', type: 'text' },
      { name: 'viewCount', type: 'integer' },
      { name: 'publishedOn', type: 'datetime' },
      { name: 'featured', type: 'checkbox' },
      { name: 'content', type: 'blocks' },
      { name: 'gallery', type: 'array' },
      { name: 'body', type: 'richText' },
      { name: 'featureImage', type: 'image' },
      { name: 'category', type: 'relation' },
      { name: 'meta', type: 'group' },
    ]
    expect(sortableFieldNames(fields)).toEqual([
      'title',
      'viewCount',
      'publishedOn',
      'featured',
      'created_at',
      'updated_at',
    ])
  })

  it('returns only the system columns for a collection with no sortable fields', () => {
    expect(sortableFieldNames([{ name: 'content', type: 'blocks' }])).toEqual([
      'created_at',
      'updated_at',
    ])
  })
})
