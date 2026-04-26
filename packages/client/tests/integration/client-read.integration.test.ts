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
const testSuffix = Date.now()

// Track created document IDs for lookup tests.
const createdDocIds: string[] = []

beforeAll(async () => {
  const definition = createTestArticlesCollection(testSuffix)
  ctx = await setupTestClient(definition)

  // Seed documents via the adapter.
  for (const article of sampleArticles) {
    const result = await ctx.db.commands.documents.createDocumentVersion({
      collectionId: ctx.collectionId,
      collectionVersion: 1,
      collectionConfig: ctx.definition,
      action: 'create',
      documentData: article,
      path: article.path,
      status: 'draft',
      locale: 'en',
    })
    createdDocIds.push(result.document.document_id as string)
  }

  // Publish the first article so we can test status filtering.
  const firstDocVersionId = (
    await ctx.db.queries.documents.getCurrentVersionMetadata({
      collection_id: ctx.collectionId,
      document_id: createdDocIds[0]!,
    })
  )?.document_version_id as string

  await ctx.db.commands.documents.setDocumentStatus({
    document_version_id: firstDocVersionId,
    status: 'published',
  })
}, 30_000)

afterAll(async () => {
  await teardownTestClient(ctx)
})

// Most of these tests seed a mix of drafts and one published doc. The Phase
// 5 client default is `status: 'published'` (fall back past drafts to the
// last published version), so tests that want to exercise read mechanics
// across the whole fixture pass `status: 'any'` explicitly. Tests that are
// specifically about the published/draft distinction omit it.
const any = { status: 'any' as const }

describe('client.collection().find()', () => {
  it('should return all seeded documents', async () => {
    const result = await ctx.client.collection(ctx.definition.path).find(any)

    expect(result.docs.length).toBe(sampleArticles.length)
    expect(result.meta.total).toBe(sampleArticles.length)
    expect(result.meta.page).toBe(1)
    expect(result.meta.pageSize).toBe(20)
  })

  it('should return camelCase shaped documents', async () => {
    const result = await ctx.client.collection(ctx.definition.path).find(any)
    const doc = result.docs[0]!

    expect(doc.id).toBeDefined()
    expect(doc.versionId).toBeDefined()
    expect(doc.path).toBeDefined()
    expect(doc.status).toBeDefined()
    expect(doc.createdAt).toBeInstanceOf(Date)
    expect(doc.updatedAt).toBeInstanceOf(Date)
    expect(doc.fields).toBeDefined()
  })

  it('should filter by status', async () => {
    const published = await ctx.client
      .collection(ctx.definition.path)
      .find({ where: { status: 'published' } })

    expect(published.docs.length).toBe(1)
    expect(published.docs[0]?.status).toBe('published')

    const drafts = await ctx.client
      .collection(ctx.definition.path)
      .find({ where: { status: 'draft' }, ...any })

    expect(drafts.docs.length).toBe(sampleArticles.length - 1)
  })

  it('should support text search via where.query', async () => {
    const result = await ctx.client
      .collection(ctx.definition.path)
      .find({ where: { query: 'Storage' }, ...any })

    expect(result.docs.length).toBe(1)
    expect(result.docs[0]?.fields.title).toContain('Storage')
  })

  it('should support pagination', async () => {
    const page1 = await ctx.client
      .collection(ctx.definition.path)
      .find({ pageSize: 2, page: 1, ...any })

    expect(page1.docs.length).toBe(2)
    expect(page1.meta.totalPages).toBe(2)

    const page2 = await ctx.client
      .collection(ctx.definition.path)
      .find({ pageSize: 2, page: 2, ...any })

    expect(page2.docs.length).toBe(1)
  })

  it('should support selective field loading', async () => {
    const result = await ctx.client
      .collection(ctx.definition.path)
      .find({ select: ['title'], ...any })

    const doc = result.docs[0]!
    expect(doc.fields.title).toBeDefined()
    // Other fields should not be present.
    expect(doc.fields.summary).toBeUndefined()
    expect(doc.fields.views).toBeUndefined()
  })
})

describe('client.collection().findOne()', () => {
  it('should return a single document', async () => {
    const doc = await ctx.client
      .collection(ctx.definition.path)
      .findOne({ where: { status: 'published' } })

    expect(doc).not.toBeNull()
    expect(doc?.status).toBe('published')
  })

  it('should return null when no match', async () => {
    const doc = await ctx.client
      .collection(ctx.definition.path)
      .findOne({ where: { status: 'nonexistent' } })

    expect(doc).toBeNull()
  })
})

describe('client.collection().findById()', () => {
  it('should return a document by its logical ID', async () => {
    const docId = createdDocIds[0]!
    const doc = await ctx.client.collection(ctx.definition.path).findById(docId)

    expect(doc).not.toBeNull()
    expect(doc?.id).toBe(docId)
    expect(doc?.fields.title).toBe(sampleArticles[0]?.title)
  })

  it('should return null for a nonexistent ID', async () => {
    const doc = await ctx.client
      .collection(ctx.definition.path)
      .findById('00000000-0000-0000-0000-000000000000')

    expect(doc).toBeNull()
  })

  it('should support selective field loading', async () => {
    const docId = createdDocIds[0]!
    const doc = await ctx.client
      .collection(ctx.definition.path)
      .findById(docId, { select: ['title'] })

    expect(doc).not.toBeNull()
    expect(doc?.fields.title).toBeDefined()
    expect(doc?.fields.summary).toBeUndefined()
  })
})

describe('client.collection().findByPath()', () => {
  it('should return a document by its path', async () => {
    const doc = await ctx.client.collection(ctx.definition.path).findByPath('getting-started')

    expect(doc).not.toBeNull()
    expect(doc?.path).toBe('getting-started')
    expect(doc?.fields.title).toBe('Getting Started with Byline')
  })

  it('should return null for a nonexistent path', async () => {
    const doc = await ctx.client.collection(ctx.definition.path).findByPath('does-not-exist')

    expect(doc).toBeNull()
  })
})

describe('client.collection().count()', () => {
  it('should return total document count', async () => {
    const total = await ctx.client.collection(ctx.definition.path).count()
    expect(total).toBe(sampleArticles.length)
  })

  it('should return count filtered by status', async () => {
    const published = await ctx.client
      .collection(ctx.definition.path)
      .count({ status: 'published' })
    expect(published).toBe(1)

    const drafts = await ctx.client.collection(ctx.definition.path).count({ status: 'draft' })
    expect(drafts).toBe(sampleArticles.length - 1)
  })

  it('should return 0 for a status with no documents', async () => {
    const archived = await ctx.client.collection(ctx.definition.path).count({ status: 'archived' })
    expect(archived).toBe(0)
  })
})
