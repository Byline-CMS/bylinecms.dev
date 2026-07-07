/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * End-to-end verification of `hasMany` relations: an article references an
 * ordered list of people via a `hasMany` relation field. The list flattens to
 * indexed `store_relation` rows, reconstructs in order, and `populate` resolves
 * each element into its own envelope — yielding an **ordered array** of
 * populated relation values (vs the single value a non-`hasMany` field gives).
 *
 * Also checks the degraded path: deleting one target leaves its slot in place
 * as a `_resolved: false` element rather than collapsing the array.
 *
 * Needs two collections (articles → people), so it wires the client via the
 * same multi-collection fixture as `client-populate-status`.
 */

import { createSuperAdminContext } from '@byline/auth'
import type { IDbAdapter } from '@byline/core'
import { defineCollection, defineWorkflow } from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupMultiCollectionTestClient } from '../fixtures/setup.js'
import type { BylineClient } from '../../src/index.js'

const superAdmin = createSuperAdminContext({ id: 'test-super-admin' })

const suffix = `${Date.now()}-multi-rel-${Math.floor(Math.random() * 1e6)}`

const peopleDefinition = defineCollection({
  path: `test-people-${suffix}`,
  labels: { singular: 'Person', plural: 'People' },
  useAsPath: 'name',
  useAsTitle: 'name',
  workflow: defineWorkflow({
    draft: { label: 'Draft', verb: 'Revert to Draft' },
    published: { label: 'Published', verb: 'Publish' },
  }),
  fields: [{ name: 'name', type: 'text', label: 'Name' }],
})

const articlesDefinition = defineCollection({
  path: `test-articles-${suffix}`,
  labels: { singular: 'Article', plural: 'Articles' },
  useAsPath: 'title',
  useAsTitle: 'title',
  workflow: defineWorkflow({
    draft: { label: 'Draft', verb: 'Revert to Draft' },
    published: { label: 'Published', verb: 'Publish' },
  }),
  fields: [
    { name: 'title', type: 'text', label: 'Title' },
    {
      name: 'authors',
      type: 'relation',
      label: 'Authors',
      targetCollection: `test-people-${suffix}`,
      hasMany: true,
      optional: true,
    },
  ],
})

type PopulatedLeaf = {
  targetDocumentId?: string
  _resolved?: boolean
  document?: { fields?: { name?: string } }
}

interface Ctx {
  client: BylineClient
  db: IDbAdapter
  peopleCollectionId: string
  articlesCollectionId: string
}

let ctx: Ctx
let articleId: string
let personA: string
let personB: string

async function setup(): Promise<Ctx> {
  const { client, db, collectionIds } = await setupMultiCollectionTestClient(
    [peopleDefinition, articlesDefinition],
    { requestContext: superAdmin }
  )
  return {
    client,
    db,
    peopleCollectionId: collectionIds[peopleDefinition.path] as string,
    articlesCollectionId: collectionIds[articlesDefinition.path] as string,
  }
}

async function teardown(c: Ctx) {
  try {
    await c.db.commands.collections.delete(c.articlesCollectionId)
  } catch (err) {
    console.error('Failed to delete articles collection:', err)
  }
  try {
    await c.db.commands.collections.delete(c.peopleCollectionId)
  } catch (err) {
    console.error('Failed to delete people collection:', err)
  }
}

beforeAll(async () => {
  ctx = await setup()

  const people = ctx.client.collection(peopleDefinition.path)
  const a = await people.create({ name: 'Ada Lovelace' })
  const b = await people.create({ name: 'Grace Hopper' })
  personA = a.documentId
  personB = b.documentId
  await people.changeStatus(personA, 'published')
  await people.changeStatus(personB, 'published')

  const articles = ctx.client.collection(articlesDefinition.path)
  const created = await articles.create({
    title: 'Computing Pioneers',
    authors: [
      { targetDocumentId: personA, targetCollectionId: ctx.peopleCollectionId },
      { targetDocumentId: personB, targetCollectionId: ctx.peopleCollectionId },
    ],
  })
  articleId = created.documentId
  await articles.changeStatus(articleId, 'published')
}, 30_000)

afterAll(async () => {
  await teardown(ctx)
})

describe('hasMany relations populate as an ordered array of envelopes', () => {
  it('returns bare refs (array, in order) when populate is not requested', async () => {
    const doc = await ctx.client
      .collection(articlesDefinition.path)
      .findById<{ authors: PopulatedLeaf[] }>(articleId)

    const authors = doc?.fields.authors ?? []
    expect(Array.isArray(authors)).toBe(true)
    expect(authors).toHaveLength(2)
    expect(authors[0]?.targetDocumentId).toBe(personA)
    expect(authors[1]?.targetDocumentId).toBe(personB)
    // No populate → no envelope discriminator.
    expect(authors[0]?._resolved).toBeUndefined()
  })

  it('populates each author into its own envelope, preserving order', async () => {
    const doc = await ctx.client
      .collection(articlesDefinition.path)
      .findById<{ authors: PopulatedLeaf[] }>(articleId, { populate: { authors: '*' } })

    const authors = doc?.fields.authors ?? []
    expect(authors).toHaveLength(2)
    expect(authors[0]?._resolved).toBe(true)
    expect(authors[0]?.document?.fields?.name).toBe('Ada Lovelace')
    expect(authors[1]?._resolved).toBe(true)
    expect(authors[1]?.document?.fields?.name).toBe('Grace Hopper')
  })

  it('keeps a deleted target as a _resolved:false slot rather than dropping it', async () => {
    await ctx.client.collection(peopleDefinition.path).delete(personB)

    const doc = await ctx.client
      .collection(articlesDefinition.path)
      .findById<{ authors: PopulatedLeaf[] }>(articleId, { populate: { authors: '*' } })

    const authors = doc?.fields.authors ?? []
    expect(authors).toHaveLength(2)
    expect(authors[0]?.document?.fields?.name).toBe('Ada Lovelace')
    expect(authors[1]?._resolved).toBe(false)
    expect(authors[1]?.document).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// hasMany query quantifiers — $some / $every / $none
// ---------------------------------------------------------------------------
//
// Runs after the populate describe above, so `personB` ("Grace Hopper") has
// been deleted and the original article resolves only `personA`. These tests
// create their own people/articles and assert by id-set, so that state is
// accounted for rather than assumed away.

describe('hasMany query quantifiers', () => {
  let alan: string
  let katherine: string
  let draftPerson: string
  let artBoth: string // authors: [Alan, Katherine] — both published
  let artMixed: string // authors: [Alan, draftPerson] — draft target unresolvable in published reads
  let artNone: string // authors: []

  beforeAll(async () => {
    const people = ctx.client.collection(peopleDefinition.path)
    const a = await people.create({ name: 'Alan Turing' })
    const k = await people.create({ name: 'Katherine Johnson' })
    const d = await people.create({ name: 'Draft Person' })
    alan = a.documentId
    katherine = k.documentId
    draftPerson = d.documentId
    await people.changeStatus(alan, 'published')
    await people.changeStatus(katherine, 'published')
    // draftPerson stays draft — invisible to published-mode target resolution.

    const articles = ctx.client.collection(articlesDefinition.path)
    const ref = (id: string) => ({
      targetDocumentId: id,
      targetCollectionId: ctx.peopleCollectionId,
    })
    const both = await articles.create({
      title: 'Quant Both',
      authors: [ref(alan), ref(katherine)],
    })
    const mixed = await articles.create({
      title: 'Quant Mixed',
      authors: [ref(alan), ref(draftPerson)],
    })
    const none = await articles.create({ title: 'Quant None', authors: [] })
    artBoth = both.documentId
    artMixed = mixed.documentId
    artNone = none.documentId
    await articles.changeStatus(artBoth, 'published')
    await articles.changeStatus(artMixed, 'published')
    await articles.changeStatus(artNone, 'published')
  }, 30_000)

  const findIds = async (where: Record<string, unknown>): Promise<Set<string>> => {
    const result = await ctx.client.collection(articlesDefinition.path).find({ where })
    return new Set(result.docs.map((d) => d.id))
  }

  it('$some matches documents with at least one satisfying target', async () => {
    const ids = await findIds({ authors: { $some: { name: 'Alan Turing' } } })
    expect(ids.has(artBoth)).toBe(true)
    expect(ids.has(artMixed)).toBe(true)
    expect(ids.has(artNone)).toBe(false)
    expect(ids.has(articleId)).toBe(false)
  })

  it('a plain sub-where on a hasMany field behaves as implicit $some', async () => {
    const ids = await findIds({ authors: { name: 'Katherine Johnson' } })
    expect(ids.has(artBoth)).toBe(true)
    expect(ids.has(artMixed)).toBe(false)
    expect(ids.has(artNone)).toBe(false)
  })

  it('$none: {} matches documents with no resolving targets at all', async () => {
    const ids = await findIds({ authors: { $none: {} } })
    expect(ids.has(artNone)).toBe(true)
    expect(ids.has(artBoth)).toBe(false)
    expect(ids.has(artMixed)).toBe(false)
    // The original article still resolves personA ("Ada Lovelace").
    expect(ids.has(articleId)).toBe(false)
  })

  it('$every ignores unresolvable targets and is vacuously true for empty sets', async () => {
    const ids = await findIds({ authors: { $every: { name: { $contains: 'Turing' } } } })
    // artMixed: Alan passes; the draft target does not resolve in published
    // mode and is ignored — every resolving target passes.
    expect(ids.has(artMixed)).toBe(true)
    // artBoth: Katherine fails the predicate.
    expect(ids.has(artBoth)).toBe(false)
    // artNone: no targets → vacuously true (Prisma-style semantics).
    expect(ids.has(artNone)).toBe(true)
    // Original article: Ada fails.
    expect(ids.has(articleId)).toBe(false)
  })

  it('multiple quantifier keys AND together', async () => {
    const ids = await findIds({
      authors: {
        $some: { name: { $contains: 'Alan' } },
        $none: { name: { $contains: 'Katherine' } },
      },
    })
    expect(ids.has(artMixed)).toBe(true)
    expect(ids.has(artBoth)).toBe(false)
    expect(ids.has(artNone)).toBe(false)
  })
})
