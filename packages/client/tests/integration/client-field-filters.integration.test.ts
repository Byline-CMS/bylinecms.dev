/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

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
    expect(result.docs[0]?.fields.views).toBeUndefined()
  })

  it('should support pagination with field filters', async () => {
    const result = await ctx.client
      .collection(ctx.definition.path)
      .find({ status: 'any', where: { views: { $lte: 150 } }, pageSize: 2, page: 1 })

    expect(result.docs.length).toBe(2)
    expect(result.meta.total).toBe(3)
    expect(result.meta.totalPages).toBe(2)
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
