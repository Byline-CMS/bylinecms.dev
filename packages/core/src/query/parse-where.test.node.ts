/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { defineCollection, defineWorkflow } from '../@types/collection-types.js'
import { mergePredicates, parseSort, parseWhere } from './parse-where.js'
import type { CollectionDefinition } from '../@types/collection-types.js'

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
    {
      name: 'category',
      type: 'relation',
      label: 'Category',
      targetCollection: 'test-categories',
      optional: true,
    },
  ],
})

const categoriesCollection = defineCollection({
  path: 'test-categories',
  labels: { singular: 'Category', plural: 'Categories' },
  workflow: defineWorkflow({
    draft: { label: 'Draft', verb: 'Revert to Draft' },
    published: { label: 'Published', verb: 'Publish' },
  }),
  fields: [
    { name: 'name', type: 'text', label: 'Name', localized: true },
    { name: 'path', type: 'text', label: 'Path' },
    {
      name: 'parent',
      type: 'relation',
      label: 'Parent',
      targetCollection: 'test-categories',
      optional: true,
    },
  ],
})

const collections: CollectionDefinition[] = [testCollection, categoriesCollection]

/** Stub resolver keyed to deterministic string ids for assertions. */
const resolveCollectionId = async (path: string) => `id-${path}`
const ctx = { collections, resolveCollectionId }

// ---------------------------------------------------------------------------
// parseWhere
// ---------------------------------------------------------------------------

describe('parseWhere', () => {
  it('should return empty result for undefined where', async () => {
    const result = await parseWhere(undefined, testCollection)
    expect(result.filters).toEqual([])
    expect(result.status).toBeUndefined()
    expect(result.query).toBeUndefined()
    expect(result.pathFilter).toBeUndefined()
  })

  it('should extract status as a document-level condition', async () => {
    const result = await parseWhere({ status: 'published' }, testCollection)
    expect(result.status).toBe('published')
    expect(result.filters).toEqual([])
  })

  it('should extract query as a document-level condition', async () => {
    const result = await parseWhere({ query: 'search term' }, testCollection)
    expect(result.query).toBe('search term')
    expect(result.filters).toEqual([])
  })

  it('should extract path with bare value as a document-level $eq filter', async () => {
    const result = await parseWhere({ path: 'hello-world' }, testCollection)
    expect(result.pathFilter).toEqual({ operator: '$eq', value: 'hello-world' })
    expect(result.filters).toEqual([])
  })

  it('should extract path with $contains operator', async () => {
    const result = await parseWhere({ path: { $contains: 'news' } }, testCollection)
    expect(result.pathFilter).toEqual({ operator: '$contains', value: 'news' })
  })

  it('should normalise bare value to $eq for text fields', async () => {
    const result = await parseWhere({ title: 'Hello' }, testCollection)
    expect(result.filters).toHaveLength(1)
    expect(result.filters[0]).toEqual({
      kind: 'field',
      fieldName: 'title',
      storeType: 'text',
      valueColumn: 'value',
      operator: '$eq',
      value: 'Hello',
    })
  })

  it('should resolve $contains on a text field', async () => {
    const result = await parseWhere({ title: { $contains: 'launch' } }, testCollection)
    expect(result.filters).toHaveLength(1)
    expect(result.filters[0]).toEqual({
      kind: 'field',
      fieldName: 'title',
      storeType: 'text',
      valueColumn: 'value',
      operator: '$contains',
      value: 'launch',
    })
  })

  it('should resolve integer fields to numeric store with value_integer column', async () => {
    const result = await parseWhere({ views: { $gte: 100 } }, testCollection)
    expect(result.filters).toHaveLength(1)
    expect(result.filters[0]).toEqual({
      kind: 'field',
      fieldName: 'views',
      storeType: 'numeric',
      valueColumn: 'value_integer',
      operator: '$gte',
      value: 100,
    })
  })

  it('should resolve float fields to numeric store with value_float column', async () => {
    const result = await parseWhere({ rating: { $gt: 4.5 } }, testCollection)
    expect(result.filters).toHaveLength(1)
    expect(result.filters[0]).toEqual({
      kind: 'field',
      fieldName: 'rating',
      storeType: 'numeric',
      valueColumn: 'value_float',
      operator: '$gt',
      value: 4.5,
    })
  })

  it('should resolve checkbox fields to boolean store', async () => {
    const result = await parseWhere({ featured: true }, testCollection)
    expect(result.filters).toHaveLength(1)
    expect(result.filters[0]).toEqual({
      kind: 'field',
      fieldName: 'featured',
      storeType: 'boolean',
      valueColumn: 'value',
      operator: '$eq',
      value: true,
    })
  })

  it('should resolve datetime fields to datetime store', async () => {
    const result = await parseWhere(
      { published_at: { $gte: '2026-01-01T00:00:00Z' } },
      testCollection
    )
    expect(result.filters).toHaveLength(1)
    expect(result.filters[0]).toEqual({
      kind: 'field',
      fieldName: 'published_at',
      storeType: 'datetime',
      valueColumn: 'value_timestamp_tz',
      operator: '$gte',
      value: '2026-01-01T00:00:00Z',
    })
  })

  it('should handle $in operator', async () => {
    const result = await parseWhere({ title: { $in: ['Hello', 'World'] } }, testCollection)
    expect(result.filters[0]).toEqual({
      kind: 'field',
      fieldName: 'title',
      storeType: 'text',
      valueColumn: 'value',
      operator: '$in',
      value: ['Hello', 'World'],
    })
  })

  it('should handle mixed document-level and field-level conditions', async () => {
    const result = await parseWhere(
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
    expect(result.filters).toHaveLength(2)
    const fieldNames = result.filters.flatMap((f) => (f.kind === 'field' ? [f.fieldName] : []))
    expect(fieldNames.sort()).toEqual(['title', 'views'])
  })

  it('should skip unknown field names silently', async () => {
    const result = await parseWhere({ nonexistent: 'value' }, testCollection)
    expect(result.filters).toEqual([])
  })

  it('should handle null values', async () => {
    const result = await parseWhere({ title: null }, testCollection)
    expect(result.filters).toHaveLength(1)
    const f = result.filters[0]!
    if (f.kind !== 'field') throw new Error('expected field filter')
    expect(f.operator).toBe('$eq')
    expect(f.value).toBeNull()
  })

  // -------------------------------------------------------------------------
  // Relation sub-where
  // -------------------------------------------------------------------------

  it('should treat bare string on a relation field as $eq on targetDocumentId', async () => {
    const result = await parseWhere({ category: 'some-category-doc-id' }, testCollection, ctx)
    expect(result.filters).toHaveLength(1)
    expect(result.filters[0]).toEqual({
      kind: 'field',
      fieldName: 'category',
      storeType: 'relation',
      valueColumn: 'target_document_id',
      operator: '$eq',
      value: 'some-category-doc-id',
    })
  })

  it('should treat an operator-object on a relation field as a scalar filter', async () => {
    const result = await parseWhere({ category: { $in: ['cat-a', 'cat-b'] } }, testCollection, ctx)
    expect(result.filters).toHaveLength(1)
    expect(result.filters[0]).toEqual({
      kind: 'field',
      fieldName: 'category',
      storeType: 'relation',
      valueColumn: 'target_document_id',
      operator: '$in',
      value: ['cat-a', 'cat-b'],
    })
  })

  it('should emit a RelationFilter for a nested plain-object sub-where', async () => {
    const result = await parseWhere({ category: { path: 'news' } }, testCollection, ctx)
    expect(result.filters).toHaveLength(1)
    expect(result.filters[0]).toEqual({
      kind: 'relation',
      fieldName: 'category',
      targetCollectionId: 'id-test-categories',
      nested: [
        {
          kind: 'field',
          fieldName: 'path',
          storeType: 'text',
          valueColumn: 'value',
          operator: '$eq',
          value: 'news',
        },
      ],
    })
  })

  it('should support operator objects inside a nested sub-where', async () => {
    const result = await parseWhere(
      { category: { name: { $contains: 'news' } } },
      testCollection,
      ctx
    )
    const relation = result.filters[0]
    expect(relation?.kind).toBe('relation')
    if (relation?.kind !== 'relation') return
    expect(relation.nested).toEqual([
      {
        kind: 'field',
        fieldName: 'name',
        storeType: 'text',
        valueColumn: 'value',
        operator: '$contains',
        value: 'news',
      },
    ])
  })

  it('should recurse into multi-hop relation sub-wheres', async () => {
    const result = await parseWhere({ category: { parent: { path: 'news' } } }, testCollection, ctx)
    const top = result.filters[0]
    expect(top?.kind).toBe('relation')
    if (top?.kind !== 'relation') return
    expect(top.fieldName).toBe('category')
    expect(top.targetCollectionId).toBe('id-test-categories')
    expect(top.nested).toHaveLength(1)

    const inner = top.nested[0]
    expect(inner?.kind).toBe('relation')
    if (inner?.kind !== 'relation') return
    expect(inner.fieldName).toBe('parent')
    expect(inner.targetCollectionId).toBe('id-test-categories')
    expect(inner.nested).toEqual([
      {
        kind: 'field',
        fieldName: 'path',
        storeType: 'text',
        valueColumn: 'value',
        operator: '$eq',
        value: 'news',
      },
    ])
  })

  it('should skip nested sub-where when ctx is not provided', async () => {
    const result = await parseWhere({ category: { path: 'news' } }, testCollection)
    expect(result.filters).toEqual([])
  })

  it('should skip nested sub-where when target collection is not registered', async () => {
    const lonelyCollection = defineCollection({
      path: 'lonely',
      labels: { singular: 'Lonely', plural: 'Lonelies' },
      workflow: defineWorkflow({
        draft: { label: 'Draft', verb: 'Revert to Draft' },
        published: { label: 'Published', verb: 'Publish' },
      }),
      fields: [
        {
          name: 'ghost',
          type: 'relation',
          label: 'Ghost',
          targetCollection: 'not-registered',
          optional: true,
        },
      ],
    })
    const result = await parseWhere({ ghost: { path: 'x' } }, lonelyCollection, {
      collections: [lonelyCollection],
      resolveCollectionId,
    })
    expect(result.filters).toEqual([])
  })

  it('should compose ordinary filters alongside a relation sub-where', async () => {
    const result = await parseWhere(
      {
        title: { $contains: 'launch' },
        category: { path: 'news' },
      },
      testCollection,
      ctx
    )
    expect(result.filters).toHaveLength(2)
    const kinds = result.filters.map((f) => f.kind).sort()
    expect(kinds).toEqual(['field', 'relation'])
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

// ---------------------------------------------------------------------------
// $and / $or combinators
// ---------------------------------------------------------------------------

describe('parseWhere — combinators', () => {
  it('flattens a top-level $and into the implicit-AND filter list', async () => {
    const result = await parseWhere(
      { $and: [{ title: 'Hello' }, { views: { $gte: 100 } }] },
      testCollection
    )
    expect(result.filters).toHaveLength(2)
    expect(result.filters[0]).toMatchObject({ kind: 'field', fieldName: 'title' })
    expect(result.filters[1]).toMatchObject({ kind: 'field', fieldName: 'views' })
  })

  it('wraps a top-level $or in a single combinator node', async () => {
    const result = await parseWhere(
      { $or: [{ title: 'Hello' }, { views: { $gte: 100 } }] },
      testCollection
    )
    expect(result.filters).toHaveLength(1)
    expect(result.filters[0]).toMatchObject({
      kind: 'or',
      children: [
        { kind: 'field', fieldName: 'title' },
        { kind: 'field', fieldName: 'views' },
      ],
    })
  })

  it('wraps multi-key $or branches in a nested AND combinator', async () => {
    const result = await parseWhere(
      {
        $or: [{ title: 'Hello', featured: true }, { views: { $gte: 100 } }],
      },
      testCollection
    )
    expect(result.filters).toHaveLength(1)
    const top = result.filters[0]!
    expect(top.kind).toBe('or')
    if (top.kind !== 'or') return
    expect(top.children).toHaveLength(2)
    expect(top.children[0]).toMatchObject({
      kind: 'and',
      children: [
        { kind: 'field', fieldName: 'title' },
        { kind: 'field', fieldName: 'featured' },
      ],
    })
    expect(top.children[1]).toMatchObject({ kind: 'field', fieldName: 'views' })
  })

  it('combines field predicates and combinators at the same level', async () => {
    const result = await parseWhere(
      {
        featured: true,
        $or: [{ title: 'Hello' }, { title: 'World' }],
      },
      testCollection
    )
    expect(result.filters).toHaveLength(2)
    expect(result.filters[0]).toMatchObject({ kind: 'field', fieldName: 'featured' })
    expect(result.filters[1]).toMatchObject({ kind: 'or' })
  })

  it('skips empty $or branches that parse to no filters', async () => {
    const result = await parseWhere(
      {
        $or: [
          { title: 'Hello' },
          // unknown-field branch — parser drops it, leaving an empty group
          { nonexistent: 'value' },
        ],
      },
      testCollection
    )
    expect(result.filters).toHaveLength(1)
    const top = result.filters[0]!
    expect(top.kind).toBe('or')
    if (top.kind !== 'or') return
    // Only the title branch survives.
    expect(top.children).toHaveLength(1)
    expect(top.children[0]).toMatchObject({ kind: 'field', fieldName: 'title' })
  })

  it('drops a $or whose every branch is empty', async () => {
    const result = await parseWhere(
      {
        $or: [{ nonexistent: 'a' }, { alsoNonexistent: 'b' }],
      },
      testCollection
    )
    // No combinator emitted — would have meant "OR of nothing", a semantic
    // landmine if compiled to SQL.
    expect(result.filters).toEqual([])
  })

  it('drops a non-array combinator value (defensive)', async () => {
    const result = await parseWhere(
      {
        // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed input
        $or: { title: 'Hello' } as any,
      },
      testCollection
    )
    expect(result.filters).toEqual([])
  })

  it('nests $or inside $and correctly', async () => {
    const result = await parseWhere(
      {
        $and: [{ featured: true }, { $or: [{ title: 'a' }, { title: 'b' }] }],
      },
      testCollection
    )
    // $and flattens to two top-level filters.
    expect(result.filters).toHaveLength(2)
    expect(result.filters[0]).toMatchObject({ kind: 'field', fieldName: 'featured' })
    expect(result.filters[1]).toMatchObject({
      kind: 'or',
      children: [
        { kind: 'field', fieldName: 'title' },
        { kind: 'field', fieldName: 'title' },
      ],
    })
  })

  it('emits a docColumn filter when status appears inside an $or', async () => {
    const result = await parseWhere(
      {
        $or: [{ status: 'published' }, { status: 'draft', title: 'Hello' }],
      },
      testCollection
    )
    // Top-level $or stays as a single combinator wrapping each branch.
    expect(result.filters).toHaveLength(1)
    const top = result.filters[0]!
    expect(top.kind).toBe('or')
    if (top.kind !== 'or') return
    expect(top.children).toHaveLength(2)
    // First branch: just a status check, downshifted from reserved key.
    expect(top.children[0]).toMatchObject({
      kind: 'docColumn',
      column: 'status',
      operator: '$eq',
      value: 'published',
    })
    // Second branch has both a status check and a title filter — wrapped
    // in an inner `and` so the outer `or` sees one node per branch.
    expect(top.children[1]).toMatchObject({ kind: 'and' })
    if (top.children[1]?.kind !== 'and') return
    expect(top.children[1].children).toHaveLength(2)
    expect(top.children[1].children[0]).toMatchObject({
      kind: 'docColumn',
      column: 'status',
      value: 'draft',
    })
    expect(top.children[1].children[1]).toMatchObject({ kind: 'field', fieldName: 'title' })
    // None of the combinator-internal status writes should leak into
    // `result.status` — that's reserved for top-level scalar filters.
    expect(result.status).toBeUndefined()
  })

  it('emits a docColumn filter when path appears inside an $or', async () => {
    const result = await parseWhere(
      { $or: [{ path: 'a' }, { path: { $contains: 'b' } }] },
      testCollection
    )
    expect(result.pathFilter).toBeUndefined() // not the top-level reserved form
    const top = result.filters[0]!
    expect(top.kind).toBe('or')
    if (top.kind !== 'or') return
    expect(top.children[0]).toMatchObject({
      kind: 'docColumn',
      column: 'path',
      operator: '$eq',
      value: 'a',
    })
    expect(top.children[1]).toMatchObject({
      kind: 'docColumn',
      column: 'path',
      operator: '$contains',
      value: 'b',
    })
  })

  it('still treats top-level status / path as the reserved scalar form', async () => {
    // Sanity: outside a combinator, status and path go on the ParsedWhere
    // top-level slots and emit no DocumentFilter.
    const result = await parseWhere({ status: 'published', path: 'foo' }, testCollection)
    expect(result.status).toBe('published')
    expect(result.pathFilter).toEqual({ operator: '$eq', value: 'foo' })
    expect(result.filters).toEqual([])
  })

  it('parses combinators inside a nested relation sub-where', async () => {
    const result = await parseWhere(
      {
        category: {
          $or: [{ name: 'News' }, { path: 'announcements' }],
        },
      },
      testCollection,
      ctx
    )
    expect(result.filters).toHaveLength(1)
    const rel = result.filters[0]!
    expect(rel.kind).toBe('relation')
    if (rel.kind !== 'relation') return
    expect(rel.nested).toHaveLength(1)
    expect(rel.nested[0]).toMatchObject({
      kind: 'or',
      children: [
        { kind: 'field', fieldName: 'name' },
        { kind: 'field', fieldName: 'path' },
      ],
    })
  })
})

// ---------------------------------------------------------------------------
// mergePredicates
// ---------------------------------------------------------------------------

describe('mergePredicates', () => {
  it('returns undefined when both sides are absent', () => {
    expect(mergePredicates(undefined, undefined)).toBeUndefined()
    expect(mergePredicates(null, undefined)).toBeUndefined()
  })

  it('returns the user where when no hook predicate', () => {
    const userWhere = { title: 'Hello' }
    expect(mergePredicates(undefined, userWhere)).toBe(userWhere)
    expect(mergePredicates(null, userWhere)).toBe(userWhere)
  })

  it('returns the hook predicate when no user where', () => {
    const hookPredicate = { tenantId: 't-1' }
    expect(mergePredicates(hookPredicate, undefined)).toBe(hookPredicate)
  })

  it('wraps both sides in $and when both present', () => {
    const hookPredicate = { tenantId: 't-1' }
    const userWhere = { status: 'published' }
    const merged = mergePredicates(hookPredicate, userWhere)
    expect(merged).toEqual({ $and: [hookPredicate, userWhere] })
  })

  it('round-trips a merged predicate through parseWhere as implicit AND', async () => {
    const merged = mergePredicates({ featured: true }, { title: 'Hello' })
    const parsed = await parseWhere(merged, testCollection)
    // Top-level $and is flattened by the parser, so we get two field filters.
    expect(parsed.filters).toHaveLength(2)
    expect(parsed.filters[0]).toMatchObject({ kind: 'field', fieldName: 'featured' })
    expect(parsed.filters[1]).toMatchObject({ kind: 'field', fieldName: 'title' })
  })
})
