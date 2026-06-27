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
