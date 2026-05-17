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
 * sub-where (e.g. `{ category: { slug: 'news' } }`).
 *
 * Verifies:
 *  - single-hop filter narrows docs by a related collection's field
 *  - draft-leak guard under readMode='published' (target-side)
 *  - locale propagation through the join
 *  - composition with ordinary field filters + relation-id filters
 *  - deleted target yields no matches (not a crash)
 *  - 2-hop recursion (category → parent → slug)
 *  - document-level reserved keys (`status`, `path`) inside a nested
 *    sub-clause map to the target version's columns; `query` is dropped
 */

import { createSuperAdminContext } from '@byline/auth'
import type { CollectionDefinition, IDbAdapter } from '@byline/core'
import { defineCollection, defineWorkflow } from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupMultiCollectionTestClient } from '../fixtures/setup.js'
import type { BylineClient } from '../../src/index.js'

const superAdmin = createSuperAdminContext({ id: 'test-super-admin' })

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
  // Derive each row's `byline_document_paths.path` from the slugified
  // name so the doc-column tests below have predictable values to assert
  // against.
  useAsPath: 'name',
  fields: [
    { name: 'name', type: 'text', label: 'Name', localized: true },
    { name: 'slug', type: 'text', label: 'Slug' },
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
  useAsPath: 'title',
  fields: [
    { name: 'title', type: 'text', label: 'Title', localized: true },
    { name: 'slug', type: 'text', label: 'Slug' },
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
  /** documentId per category by slug */
  categoryIds: Map<string, string>
}

let ctx: Ctx

async function setup(): Promise<Ctx> {
  const { client, db, collectionIds } = await setupMultiCollectionTestClient(
    [categoriesDefinition, articlesDefinition],
    { requestContext: superAdmin }
  )
  return {
    client,
    db,
    articlesCollectionId: collectionIds[articlesDefinition.path] as string,
    categoriesCollectionId: collectionIds[categoriesDefinition.path] as string,
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
  // `useAsPath: 'name'` means each gets a doc-level path slugified from
  // its name ("News" → "news", etc.) — the doc-column tests rely on that.
  for (const seed of [
    { name: 'News', slug: 'news' },
    { name: 'Features', slug: 'features' },
  ]) {
    const handle = ctx.client.collection(ctx.categoriesDefinition.path)
    const created = await handle.create({ name: seed.name, slug: seed.slug })
    await handle.changeStatus(created.documentId, 'published')
    ctx.categoryIds.set(seed.slug, created.documentId)
  }

  // Seed a third category that is kept in DRAFT so we can test the
  // published-readMode join filter (the article pointing at it should
  // disappear in the published view).
  const draftCat = await ctx.client
    .collection(ctx.categoriesDefinition.path)
    .create({ name: 'Hidden', slug: 'hidden' })
  ctx.categoryIds.set('hidden', draftCat.documentId)

  // A nested parent category for 2-hop tests. Parent is "News" itself,
  // already seeded above.
  const subCat = await ctx.client.collection(ctx.categoriesDefinition.path).create({
    name: 'Breaking',
    slug: 'breaking',
    parent: {
      targetDocumentId: ctx.categoryIds.get('news'),
      targetCollectionId: ctx.categoriesCollectionId,
    },
  })
  await ctx.client
    .collection(ctx.categoriesDefinition.path)
    .changeStatus(subCat.documentId, 'published')
  ctx.categoryIds.set('breaking', subCat.documentId)

  // Seed articles, each categorised into one of the categories.
  const articlesHandle = ctx.client.collection(ctx.articlesDefinition.path)
  const articleSeeds = [
    { title: 'News A', slug: 'news-a', cat: 'news' },
    { title: 'News B', slug: 'news-b', cat: 'news' },
    { title: 'Features A', slug: 'features-a', cat: 'features' },
    // Points at the draft-only category. Should vanish from published reads.
    { title: 'Orphan', slug: 'orphan', cat: 'hidden' },
    // Points at the nested "breaking" category (child of "news").
    { title: 'Breaking Story', slug: 'breaking-story', cat: 'breaking' },
  ]
  for (const seed of articleSeeds) {
    const created = await articlesHandle.create({
      title: seed.title,
      slug: seed.slug,
      category: {
        targetDocumentId: ctx.categoryIds.get(seed.cat),
        targetCollectionId: ctx.categoriesCollectionId,
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
  it('narrows docs by a relation target field (category.slug = news)', async () => {
    const result = await ctx.client.collection(ctx.articlesDefinition.path).find({
      where: { category: { slug: 'news' } },
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
        category: { slug: 'news' },
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
      where: { category: { slug: 'hidden' } },
    })
    expect(result.docs).toEqual([])
  })

  it("finds the draft-target article under status: 'any'", async () => {
    const result = await ctx.client.collection(ctx.articlesDefinition.path).find({
      status: 'any',
      where: { category: { slug: 'hidden' } },
    })
    expect(result.docs.map((d) => d.fields.title)).toEqual(['Orphan'])
  })

  it('returns no rows when the target field predicate matches nothing', async () => {
    const result = await ctx.client.collection(ctx.articlesDefinition.path).find({
      where: { category: { slug: 'does-not-exist' } },
    })
    expect(result.docs).toEqual([])
  })

  it('recurses 2 hops (category → parent → slug)', async () => {
    // Sanity on the inner hop (breaking → parent=news).
    const oneHop = await ctx.client.collection(ctx.categoriesDefinition.path).find({
      where: { parent: { slug: 'news' } },
    })
    expect(oneHop.docs.map((d) => d.fields.name)).toEqual(['Breaking'])

    // "Breaking Story" → breaking → parent=news. So a filter
    // `{ category: { parent: { slug: 'news' } } }` should find it.
    const result = await ctx.client.collection(ctx.articlesDefinition.path).find({
      where: { category: { parent: { slug: 'news' } } },
    })
    expect(result.docs.map((d) => d.fields.title)).toEqual(['Breaking Story'])
  })
})

describe('document-level reserved keys inside a nested where', () => {
  it('filters by the target document `path` (`category.path`)', async () => {
    // `useAsPath: 'name'` slugifies "News" → "news" into the target's
    // `byline_document_paths` row. The reserved-key promotion at
    // parse-where emits a DocumentColumnFilter that the adapter resolves
    // via a `pathProjection` subquery against the relation hop's
    // `td0.document_id`.
    const result = await ctx.client.collection(ctx.articlesDefinition.path).find({
      where: { category: { path: 'news' } },
    })
    const titles = result.docs.map((d) => d.fields.title as string).sort()
    expect(titles).toEqual(['News A', 'News B'])
  })

  it("filters by the target version `status` column (target draft + status: 'any')", async () => {
    // Hidden category is in 'draft'; under status: 'any' both source and
    // target use current_documents, so Orphan surfaces and the doc-column
    // filter on `category.status = 'draft'` keeps it.
    const result = await ctx.client.collection(ctx.articlesDefinition.path).find({
      status: 'any',
      where: { category: { status: 'draft' } },
    })
    expect(result.docs.map((d) => d.fields.title)).toEqual(['Orphan'])
  })

  it('drops `query` inside a relation sub-clause (no row filter applied)', async () => {
    // With `query` dropped, the relation filter degenerates to "has any
    // category at all". Under status: 'published' the join to the target's
    // current_published_documents still excludes the draft-target Orphan,
    // so the result is the four published-target articles.
    const result = await ctx.client.collection(ctx.articlesDefinition.path).find({
      where: { category: { query: 'whatever' } },
    })
    const titles = result.docs.map((d) => d.fields.title as string).sort()
    expect(titles).toEqual(['Breaking Story', 'Features A', 'News A', 'News B'])
  })

  it('recurses 2 hops with the doc-column form (`category.parent.path`)', async () => {
    // Same shape as the slug-based 2-hop test, but anchored on the inner
    // hop's `byline_document_paths` row resolved via a `pathProjection`
    // subquery against the depth-2 `td1.document_id`.
    const result = await ctx.client.collection(ctx.articlesDefinition.path).find({
      where: { category: { parent: { path: 'news' } } },
    })
    expect(result.docs.map((d) => d.fields.title)).toEqual(['Breaking Story'])
  })
})
