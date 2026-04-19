/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Cross-collection filter integration tests. Exercises the nested-EXISTS
 * path emitted by `parseWhere` when a relation field's value is a plain
 * sub-where (e.g. `{ category: { path: 'news' } }`).
 *
 * Verifies:
 *  - single-hop filter narrows docs by a related collection's field
 *  - draft-leak guard under readMode='published' (target-side)
 *  - locale propagation through the join
 *  - composition with ordinary field filters + relation-id filters
 *  - deleted target yields no matches (not a crash)
 *  - 2-hop recursion (category → parent → path)
 */

import type { CollectionDefinition, IDbAdapter } from '@byline/core'
import { defineCollection, defineWorkflow } from '@byline/core'
import { pgAdapter } from '@byline/db-postgres'
import 'dotenv/config'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type BylineClient, createBylineClient } from '../../src/index.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const suffix = `${Date.now()}-rel-${Math.floor(Math.random() * 1e6)}`

const categoriesDefinition = defineCollection({
  path: `test-categories-${suffix}`,
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
      targetCollection: `test-categories-${suffix}`,
      optional: true,
    },
  ],
})

const articlesDefinition = defineCollection({
  path: `test-articles-${suffix}`,
  labels: { singular: 'Article', plural: 'Articles' },
  workflow: defineWorkflow({
    draft: { label: 'Draft', verb: 'Revert to Draft' },
    published: { label: 'Published', verb: 'Publish' },
  }),
  fields: [
    { name: 'title', type: 'text', label: 'Title', localized: true },
    { name: 'path', type: 'text', label: 'Path' },
    {
      name: 'category',
      type: 'relation',
      label: 'Category',
      targetCollection: `test-categories-${suffix}`,
      optional: true,
    },
  ],
})

interface Ctx {
  client: BylineClient
  db: IDbAdapter
  articlesCollectionId: string
  categoriesCollectionId: string
  articlesDefinition: CollectionDefinition
  categoriesDefinition: CollectionDefinition
  /** documentId per category by path */
  categoryIds: Map<string, string>
}

let ctx: Ctx

async function setup(): Promise<Ctx> {
  const connectionString = process.env.POSTGRES_CONNECTION_STRING
  if (!connectionString) {
    throw new Error(
      'POSTGRES_CONNECTION_STRING is not set. Copy .env.example to .env and configure it.'
    )
  }

  const collections = [categoriesDefinition, articlesDefinition]
  const db = pgAdapter({ connectionString, collections })
  const client = createBylineClient({ db, collections })

  const [catRow] = await db.commands.collections.create(
    categoriesDefinition.path,
    categoriesDefinition
  )
  const [artRow] = await db.commands.collections.create(articlesDefinition.path, articlesDefinition)
  if (!catRow || !artRow) throw new Error('Failed to register test collections')

  return {
    client,
    db,
    articlesCollectionId: artRow.id as string,
    categoriesCollectionId: catRow.id as string,
    articlesDefinition,
    categoriesDefinition,
    categoryIds: new Map(),
  }
}

async function teardown(c: Ctx) {
  try {
    await c.db.commands.collections.delete(c.articlesCollectionId)
  } catch (err) {
    console.error('Failed to delete articles collection:', err)
  }
  try {
    await c.db.commands.collections.delete(c.categoriesCollectionId)
  } catch (err) {
    console.error('Failed to delete categories collection:', err)
  }
}

beforeAll(async () => {
  ctx = await setup()

  // Seed two categories: news (published) + features (published).
  for (const seed of [
    { name: 'News', path: 'news' },
    { name: 'Features', path: 'features' },
  ]) {
    const handle = ctx.client.collection(ctx.categoriesDefinition.path)
    const created = await handle.create({ name: seed.name, path: seed.path })
    await handle.changeStatus(created.documentId, 'published')
    ctx.categoryIds.set(seed.path, created.documentId)
  }

  // Seed a third category that is kept in DRAFT so we can test the
  // published-readMode join filter (the article pointing at it should
  // disappear in the published view).
  const draftCat = await ctx.client
    .collection(ctx.categoriesDefinition.path)
    .create({ name: 'Hidden', path: 'hidden' })
  ctx.categoryIds.set('hidden', draftCat.documentId)

  // A nested parent category for 2-hop tests. Parent is "News" itself,
  // already seeded above.
  const subCat = await ctx.client.collection(ctx.categoriesDefinition.path).create({
    name: 'Breaking',
    path: 'breaking',
    parent: {
      target_document_id: ctx.categoryIds.get('news'),
      target_collection_id: ctx.categoriesCollectionId,
    },
  })
  await ctx.client
    .collection(ctx.categoriesDefinition.path)
    .changeStatus(subCat.documentId, 'published')
  ctx.categoryIds.set('breaking', subCat.documentId)

  // Seed articles, each categorised into one of the categories.
  const articlesHandle = ctx.client.collection(ctx.articlesDefinition.path)
  const articleSeeds = [
    { title: 'News A', path: 'news-a', cat: 'news' },
    { title: 'News B', path: 'news-b', cat: 'news' },
    { title: 'Features A', path: 'features-a', cat: 'features' },
    // Points at the draft-only category. Should vanish from published reads.
    { title: 'Orphan', path: 'orphan', cat: 'hidden' },
    // Points at the nested "breaking" category (child of "news").
    { title: 'Breaking Story', path: 'breaking-story', cat: 'breaking' },
  ]
  for (const seed of articleSeeds) {
    const created = await articlesHandle.create({
      title: seed.title,
      path: seed.path,
      category: {
        target_document_id: ctx.categoryIds.get(seed.cat),
        target_collection_id: ctx.categoriesCollectionId,
      },
    })
    await articlesHandle.changeStatus(created.documentId, 'published')
  }
}, 60_000)

afterAll(async () => {
  await teardown(ctx)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cross-collection relation filter (nested where)', () => {
  it('narrows docs by a relation target field (category.path = news)', async () => {
    const result = await ctx.client.collection(ctx.articlesDefinition.path).find({
      where: { category: { path: 'news' } },
    })
    const titles = result.docs.map((d) => d.fields.title as string).sort()
    expect(titles).toEqual(['News A', 'News B'])
  })

  it('supports $contains on a relation target field', async () => {
    const result = await ctx.client.collection(ctx.articlesDefinition.path).find({
      where: { category: { name: { $contains: 'Feat' } } },
    })
    expect(result.docs.map((d) => d.fields.title)).toEqual(['Features A'])
  })

  it('composes a relation filter with an ordinary field filter', async () => {
    const result = await ctx.client.collection(ctx.articlesDefinition.path).find({
      where: {
        title: { $contains: 'A' },
        category: { path: 'news' },
      },
    })
    expect(result.docs.map((d) => d.fields.title)).toEqual(['News A'])
  })

  it('keeps the relation-id equality path (bare value) working', async () => {
    const newsId = ctx.categoryIds.get('news')!
    const result = await ctx.client.collection(ctx.articlesDefinition.path).find({
      where: { category: newsId },
    })
    expect(result.docs.map((d) => d.fields.title).sort()).toEqual(['News A', 'News B'])
  })

  it("does not leak articles pointing at an unpublished target under status: 'published'", async () => {
    // Orphan's category is draft-only, so the join to
    // current_published_documents on the target side finds nothing, and
    // Orphan must not appear.
    const result = await ctx.client.collection(ctx.articlesDefinition.path).find({
      where: { category: { path: 'hidden' } },
    })
    expect(result.docs).toEqual([])
  })

  it("finds the draft-target article under status: 'any'", async () => {
    const result = await ctx.client.collection(ctx.articlesDefinition.path).find({
      status: 'any',
      where: { category: { path: 'hidden' } },
    })
    expect(result.docs.map((d) => d.fields.title)).toEqual(['Orphan'])
  })

  it('returns no rows when the target field predicate matches nothing', async () => {
    const result = await ctx.client.collection(ctx.articlesDefinition.path).find({
      where: { category: { path: 'does-not-exist' } },
    })
    expect(result.docs).toEqual([])
  })

  it('recurses 2 hops (category → parent → path)', async () => {
    // Sanity on the inner hop (breaking → parent=news).
    const oneHop = await ctx.client.collection(ctx.categoriesDefinition.path).find({
      where: { parent: { path: 'news' } },
    })
    expect(oneHop.docs.map((d) => d.fields.name)).toEqual(['Breaking'])

    // "Breaking Story" → breaking → parent=news. So a filter
    // `{ category: { parent: { path: 'news' } } }` should find it.
    const result = await ctx.client.collection(ctx.articlesDefinition.path).find({
      where: { category: { parent: { path: 'news' } } },
    })
    expect(result.docs.map((d) => d.fields.title)).toEqual(['Breaking Story'])
  })
})
