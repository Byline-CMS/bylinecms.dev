/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { defineCollection, defineWorkflow } from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTestArticlesCollection, sampleArticles } from '../fixtures/collections.js'
import { setupTestClient, type TestContext, teardownTestClient } from '../fixtures/setup.js'

let ctx: TestContext
const testSuffix = `field-filter-${Date.now()}`

// Phase 5 defaults reads to `status: 'published'`. This suite seeds a mix
// of drafts + one published doc and then exercises filter/sort mechanics
// across the whole fixture — so every find() in it explicitly opts into
// `status: 'any'`.
const any = { status: 'any' as const }

beforeAll(async () => {
  const definition = createTestArticlesCollection(testSuffix)
  ctx = await setupTestClient(definition)

  // Seed documents via the adapter.
  for (const article of sampleArticles) {
    await ctx.db.commands.documents.createDocumentVersion({
      collectionId: ctx.collectionId,
      collectionVersion: 1,
      collectionConfig: ctx.definition,
      action: 'create',
      documentData: article,
      path: article.path,
      status: 'draft',
      locale: 'en',
    })
  }

  // Publish the first article so we can test mixed status + field filters.
  // Fixture seeds drafts → needs `any` to find the first one.
  const firstDoc = await ctx.client.collection(ctx.definition.path).findOne(any)
  if (firstDoc) {
    await ctx.db.commands.documents.setDocumentStatus({
      document_version_id: firstDoc.versionId,
      status: 'published',
    })
  }
}, 30_000)

afterAll(async () => {
  await teardownTestClient(ctx)
})

// ---------------------------------------------------------------------------
// Field-level filters
// ---------------------------------------------------------------------------

describe('field-level filters via find()', () => {
  it('should filter by text field with $contains', async () => {
    const result = await ctx.client
      .collection(ctx.definition.path)
      .find({ status: 'any', where: { title: { $contains: 'Storage' } } })

    expect(result.docs.length).toBe(1)
    expect(result.docs[0]?.fields.title).toContain('Storage')
  })

  it('should filter by text field with exact $eq', async () => {
    const result = await ctx.client
      .collection(ctx.definition.path)
      .find({ status: 'any', where: { title: 'Building a Client API' } })

    expect(result.docs.length).toBe(1)
    expect(result.docs[0]?.fields.title).toBe('Building a Client API')
  })

  it('should filter by integer field with $gte', async () => {
    const result = await ctx.client
      .collection(ctx.definition.path)
      .find({ status: 'any', where: { views: { $gte: 100 } } })

    // Only "Getting Started" has views=150
    expect(result.docs.length).toBe(1)
    expect(result.docs[0]?.fields.views).toBeGreaterThanOrEqual(100)
  })

  it('should filter by integer field with $lte', async () => {
    const result = await ctx.client
      .collection(ctx.definition.path)
      .find({ status: 'any', where: { views: { $lte: 42 } } })

    // "Advanced Storage" (42) and "Building a Client API" (0)
    expect(result.docs.length).toBe(2)
    for (const doc of result.docs) {
      expect(doc.fields.views).toBeLessThanOrEqual(42)
    }
  })

  it('should filter by boolean/checkbox field', async () => {
    const result = await ctx.client
      .collection(ctx.definition.path)
      .find({ status: 'any', where: { featured: true } })

    // Only "Getting Started" is featured
    expect(result.docs.length).toBe(1)
    expect(result.docs[0]?.fields.featured).toBe(true)
  })

  it('should combine multiple field filters (AND)', async () => {
    const result = await ctx.client.collection(ctx.definition.path).find({
      status: 'any',
      where: {
        views: { $gte: 10 },
        featured: false,
      },
    })

    // Only "Advanced Storage" (views=42, featured=false) matches both
    expect(result.docs.length).toBe(1)
    expect(result.docs[0]?.fields.title).toContain('Storage')
  })

  // Fixture views: 150, 42, 0. Every operator in one object applies (ANDed).
  it.each([
    ['closed range', { $gte: 0, $lte: 42 }, [0, 42]],
    ['exclusive range', { $gt: 0, $lt: 150 }, [42]],
    ['mixed range', { $gt: 0, $lte: 150 }, [42, 150]],
    ['contradictory range', { $gte: 5, $lte: 1 }, []],
    ['$eq with a range', { $eq: 42, $lt: 100 }, [42]],
    ['$eq outside the range', { $eq: 150, $lt: 100 }, []],
    ['downstream date-range shape', { $gt: 0, $gte: 40, $lte: 100 }, [42]],
  ])('should apply every operator of a %s', async (_label, views, expected) => {
    const result = await ctx.client
      .collection(ctx.definition.path)
      .find({ status: 'any', where: { views } })

    expect(result.docs.map((doc) => doc.fields.views).sort((a, b) => a - b)).toEqual(expected)
  })

  it('should keep the $and workaround for ranges working', async () => {
    const result = await ctx.client.collection(ctx.definition.path).find({
      status: 'any',
      where: { $and: [{ views: { $gt: 0 } }, { views: { $gte: 40 } }, { views: { $lte: 100 } }] },
    })

    expect(result.docs.map((doc) => doc.fields.views)).toEqual([42])
  })

  it.each([
    [{ views: {} }, 'is empty'],
    [{ views: { $gte: 10, $bogus: 1 } }, "unknown operator '$bogus'"],
    [{ $or: { views: 42 } }, '$or must be an array of predicates'],
  ])('should reject %o instead of dropping it', async (where, message) => {
    await expect(
      ctx.client.collection(ctx.definition.path).find({ status: 'any', where: where as never })
    ).rejects.toThrow(message)
  })

  it('should apply a top-level status operator object', async () => {
    const result = await ctx.client
      .collection(ctx.definition.path)
      .find({ status: 'any', where: { status: { $in: ['published'] } } })

    expect(result.docs).toHaveLength(1)
    expect(result.docs[0]?.status).toBe('published')
  })

  it('should combine document-level status with field-level filters', async () => {
    const result = await ctx.client.collection(ctx.definition.path).find({
      status: 'any',
      where: {
        status: 'draft',
        views: { $lte: 42 },
      },
    })

    // Only drafts with views <= 42
    for (const doc of result.docs) {
      expect(doc.status).toBe('draft')
      expect(doc.fields.views).toBeLessThanOrEqual(42)
    }
  })

  it('should return correct total count with field filters', async () => {
    const result = await ctx.client
      .collection(ctx.definition.path)
      .find({ status: 'any', where: { featured: true } })

    expect(result.meta.total).toBe(1)
    expect(result.meta.totalPages).toBe(1)
  })

  it('should return empty result when no documents match', async () => {
    const result = await ctx.client
      .collection(ctx.definition.path)
      .find({ status: 'any', where: { views: { $gte: 9999 } } })

    expect(result.docs).toEqual([])
    expect(result.meta.total).toBe(0)
  })

  it('should support selective field loading with field filters', async () => {
    const result = await ctx.client
      .collection(ctx.definition.path)
      .find({ status: 'any', where: { featured: true }, select: ['title'] })

    expect(result.docs.length).toBe(1)
    expect(result.docs[0]?.fields.title).toBeDefined()
    expect(result.docs[0]?.fields).not.toHaveProperty('views')
  })

  it('should support pagination with field filters', async () => {
    const result = await ctx.client
      .collection(ctx.definition.path)
      .find({ status: 'any', where: { views: { $lte: 150 } }, pageSize: 2, page: 1 })

    expect(result.docs.length).toBe(2)
    expect(result.meta.total).toBe(3)
    expect(result.meta.totalPages).toBe(2)
  })

  it('should filter by `id` with bare value (single document)', async () => {
    // `id` is a reserved document-level key in parse-where — it compiles
    // to a DocumentColumnFilter against the current-documents view's
    // `document_id` column, no EAV EXISTS.
    const all = await ctx.client.collection(ctx.definition.path).find(any)
    const [first] = all.docs
    if (!first) throw new Error('fixture missing: expected at least one seeded doc')

    const result = await ctx.client
      .collection(ctx.definition.path)
      .find({ status: 'any', where: { id: first.id } })

    expect(result.docs).toHaveLength(1)
    expect(result.docs[0]?.id).toBe(first.id)
    expect(result.meta.total).toBe(1)
  })

  it('should filter by `id` with $in (batch lookup)', async () => {
    // Headline use case: batch fetch a subset of known document ids. The
    // richtext-lexical populate walker uses this shape after the v2.5.1
    // fix migrates it back from `getDocumentsByDocumentIds`.
    const all = await ctx.client.collection(ctx.definition.path).find(any)
    const [first, , third] = all.docs
    if (!first || !third) {
      throw new Error('fixture missing: expected at least three seeded docs')
    }
    const wanted: string[] = [first.id, third.id]

    const result = await ctx.client
      .collection(ctx.definition.path)
      .find({ status: 'any', where: { id: { $in: wanted } } })

    expect(result.docs).toHaveLength(2)
    const returnedIds = result.docs.map((d) => d.id).sort()
    expect(returnedIds).toEqual([...wanted].sort())
  })

  it('should return empty result for `id: { $in: [] }`', async () => {
    // Empty `$in` short-circuits to `FALSE` in buildFilterCondition.
    const result = await ctx.client
      .collection(ctx.definition.path)
      .find({ status: 'any', where: { id: { $in: [] } } })

    expect(result.docs).toEqual([])
    expect(result.meta.total).toBe(0)
  })

  it('should compose `id` with other filters via implicit AND', async () => {
    const all = await ctx.client.collection(ctx.definition.path).find(any)
    const featuredDoc = all.docs.find((d) => d.fields.featured === true)
    if (!featuredDoc) {
      throw new Error('fixture missing: expected at least one featured doc')
    }

    const result = await ctx.client.collection(ctx.definition.path).find({
      status: 'any',
      where: { id: featuredDoc.id, featured: true },
    })

    expect(result.docs).toHaveLength(1)
    expect(result.docs[0]?.id).toBe(featuredDoc.id)
  })
})

// ---------------------------------------------------------------------------
// Field-level sorting
// ---------------------------------------------------------------------------

describe('field-level sorting via find()', () => {
  it('should sort by text field ascending', async () => {
    const result = await ctx.client
      .collection(ctx.definition.path)
      .find({ status: 'any', sort: { title: 'asc' } })

    const titles = result.docs.map((d) => d.fields.title)
    const sorted = [...titles].sort()
    expect(titles).toEqual(sorted)
  })

  it('should sort by text field descending', async () => {
    const result = await ctx.client
      .collection(ctx.definition.path)
      .find({ status: 'any', sort: { title: 'desc' } })

    const titles = result.docs.map((d) => d.fields.title)
    const sorted = [...titles].sort().reverse()
    expect(titles).toEqual(sorted)
  })

  it('should sort by integer field ascending', async () => {
    const result = await ctx.client
      .collection(ctx.definition.path)
      .find({ status: 'any', sort: { views: 'asc' } })

    const views = result.docs.map((d) => d.fields.views as number)
    for (let i = 1; i < views.length; i++) {
      expect(views[i]).toBeGreaterThanOrEqual(views[i - 1]!)
    }
  })

  it('should sort by integer field descending', async () => {
    const result = await ctx.client
      .collection(ctx.definition.path)
      .find({ status: 'any', sort: { views: 'desc' } })

    const views = result.docs.map((d) => d.fields.views as number)
    for (let i = 1; i < views.length; i++) {
      expect(views[i]).toBeLessThanOrEqual(views[i - 1]!)
    }
  })

  it('should combine field-level filter with field-level sort', async () => {
    const result = await ctx.client
      .collection(ctx.definition.path)
      .find({ status: 'any', where: { views: { $gte: 1 } }, sort: { views: 'asc' } })

    // Should only include docs with views >= 1 (excludes views=0)
    expect(result.docs.length).toBe(2)
    expect(result.docs[0]?.fields.views).toBeLessThanOrEqual(result.docs[1]?.fields.views as number)
  })
})

// ---------------------------------------------------------------------------
// findOne with field filters
// ---------------------------------------------------------------------------

describe('findOne with field-level filters', () => {
  it('should return a single matching document', async () => {
    const doc = await ctx.client
      .collection(ctx.definition.path)
      .findOne({ status: 'any', where: { featured: true } })

    expect(doc).not.toBeNull()
    expect(doc?.fields.featured).toBe(true)
  })

  it('should return null when no document matches', async () => {
    const doc = await ctx.client
      .collection(ctx.definition.path)
      .findOne({ status: 'any', where: { views: { $gte: 9999 } } })

    expect(doc).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Downstream regression: integer date range with a `$gt: 0` guard
// ---------------------------------------------------------------------------

describe('multi-operator date range on an integer field', () => {
  let books: TestContext

  beforeAll(async () => {
    books = await setupTestClient(
      defineCollection({
        path: `test-books-${Date.now()}`,
        labels: { singular: 'Book', plural: 'Books' },
        workflow: defineWorkflow({
          draft: { label: 'Draft', verb: 'Revert to Draft' },
          published: { label: 'Published', verb: 'Publish' },
        }),
        fields: [
          { name: 'title', type: 'text', label: 'Title' },
          { name: 'publicationDate', type: 'integer', label: 'Publication date', optional: true },
        ],
      })
    )
    // `0` stands in for "undated", which the downstream `$gt: 0` excludes.
    for (const [title, publicationDate] of [
      ['Undated', 0],
      ['Late 2019', 20191231],
      ['Start 2020', 20200101],
      ['Mid 2020', 20200615],
      ['End 2020', 20201231],
      ['Start 2021', 20210101],
    ] as const) {
      await books.db.commands.documents.createDocumentVersion({
        collectionId: books.collectionId,
        collectionVersion: 1,
        collectionConfig: books.definition,
        action: 'create',
        documentData: { title, publicationDate },
        status: 'draft',
        locale: 'en',
      })
    }
  }, 30_000)

  afterAll(async () => {
    await teardownTestClient(books)
  })

  it('applies every operator of { $gt: 0, $gte: 20200000, $lte: 20201231 }', async () => {
    const result = await books.client.collection(books.definition.path).find({
      status: 'any',
      where: { publicationDate: { $gt: 0, $gte: 20200000, $lte: 20201231 } },
    })

    expect(result.docs.map((doc) => doc.fields.publicationDate).sort((a, b) => a - b)).toEqual([
      20200101, 20200615, 20201231,
    ])
    expect(result.meta.total).toBe(3)
  })
})
