/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * End-to-end verification that populated relation targets respect the
 * outer read's `readMode`. Phase 5 is already unit-covered (the client
 * threads `readMode` to `getDocumentsByDocumentIds`) and the outer
 * `findById`/`findByPath`/`find` draft-leak is integration-covered in
 * `client-status-aware.integration.test.ts`. This file closes the last
 * end-to-end gap: a populated target that is itself in a
 * draft-over-published state should surface its *published* fields by
 * default, and its *draft* fields only when `status: 'any'`.
 *
 * Needs two collections (posts → author), which the shared
 * `setupTestClient` fixture does not support, so it wires the client
 * inline in the same shape as `client-relation-filters`.
 */

import { createSuperAdminContext } from '@byline/auth'
import type { CollectionDefinition, IDbAdapter } from '@byline/core'
import { defineCollection, defineWorkflow } from '@byline/core'
import { pgAdapter } from '@byline/db-postgres'
import 'dotenv/config'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type BylineClient, createBylineClient } from '../../src/index.js'

const superAdmin = createSuperAdminContext({ id: 'test-super-admin' })

const suffix = `${Date.now()}-pop-status-${Math.floor(Math.random() * 1e6)}`

const authorsDefinition = defineCollection({
  path: `test-authors-${suffix}`,
  labels: { singular: 'Author', plural: 'Authors' },
  useAsPath: 'name',
  workflow: defineWorkflow({
    draft: { label: 'Draft', verb: 'Revert to Draft' },
    published: { label: 'Published', verb: 'Publish' },
  }),
  fields: [
    { name: 'name', type: 'text', label: 'Name' },
    { name: 'bio', type: 'text', label: 'Bio' },
  ],
})

const postsDefinition = defineCollection({
  path: `test-posts-${suffix}`,
  labels: { singular: 'Post', plural: 'Posts' },
  useAsPath: 'title',
  workflow: defineWorkflow({
    draft: { label: 'Draft', verb: 'Revert to Draft' },
    published: { label: 'Published', verb: 'Publish' },
  }),
  fields: [
    { name: 'title', type: 'text', label: 'Title' },
    {
      name: 'author',
      type: 'relation',
      label: 'Author',
      targetCollection: `test-authors-${suffix}`,
      optional: true,
    },
  ],
})

interface Ctx {
  client: BylineClient
  db: IDbAdapter
  authorsCollectionId: string
  postsCollectionId: string
}

let ctx: Ctx
let authorId: string
let postId: string

async function setup(): Promise<Ctx> {
  const connectionString = process.env.POSTGRES_CONNECTION_STRING
  if (!connectionString) {
    throw new Error(
      'POSTGRES_CONNECTION_STRING is not set. Copy .env.example to .env and configure it.'
    )
  }

  const collections: CollectionDefinition[] = [authorsDefinition, postsDefinition]
  const db = pgAdapter({ connectionString, collections })
  const client = createBylineClient({ db, collections, requestContext: superAdmin })

  const [authorsRow] = await db.commands.collections.create(
    authorsDefinition.path,
    authorsDefinition
  )
  const [postsRow] = await db.commands.collections.create(postsDefinition.path, postsDefinition)
  if (!authorsRow || !postsRow) throw new Error('Failed to register test collections')

  return {
    client,
    db,
    authorsCollectionId: authorsRow.id as string,
    postsCollectionId: postsRow.id as string,
  }
}

async function teardown(c: Ctx) {
  try {
    await c.db.commands.collections.delete(c.postsCollectionId)
  } catch (err) {
    console.error('Failed to delete posts collection:', err)
  }
  try {
    await c.db.commands.collections.delete(c.authorsCollectionId)
  } catch (err) {
    console.error('Failed to delete authors collection:', err)
  }
}

beforeAll(async () => {
  ctx = await setup()

  // Drive the author into a draft-over-published state:
  //   v1: create → draft
  //   publish  → v1 is 'published'
  //   update   → v2 is 'draft' (v1 remains 'published')
  const authors = ctx.client.collection(authorsDefinition.path)
  const createdAuthor = await authors.create({ name: 'Ada Lovelace', bio: 'Published bio.' })
  authorId = createdAuthor.documentId

  await authors.changeStatus(authorId, 'published')
  await authors.update(authorId, { name: 'Ada Lovelace', bio: 'In-progress draft bio.' })

  // A single post pointing at the author — we read it with populate and
  // assert the populated `author.bio` reflects the requested readMode.
  const posts = ctx.client.collection(postsDefinition.path)
  const createdPost = await posts.create({
    title: 'Difference Engine',
    author: {
      target_document_id: authorId,
      target_collection_id: ctx.authorsCollectionId,
    },
  })
  postId = createdPost.documentId

  // Publish the post itself so it's visible in the default-mode list.
  await posts.changeStatus(postId, 'published')
}, 30_000)

afterAll(async () => {
  await teardown(ctx)
})

// Shape of a populated-relation leaf after the client's shape pass. The
// envelope is `{ target_document_id, target_collection_id, _resolved: true,
// document: ClientDocument }` (see `PopulatedRelationValue` in
// @byline/core/services/populate.ts).
type PopulatedLeaf = {
  _resolved?: boolean
  _cycle?: boolean
  document?: {
    id?: string
    status?: string
    fields?: { bio?: string; name?: string }
  }
}

describe('populate inherits the outer read mode end-to-end', () => {
  it("default (status: 'published') populates the author's published fields", async () => {
    const handle = ctx.client.collection(postsDefinition.path)
    const doc = await handle.findById<{ title: string; author: PopulatedLeaf }>(postId, {
      populate: { author: '*' },
    })

    expect(doc).not.toBeNull()
    const author = doc?.fields.author ?? null

    expect(author).not.toBeNull()
    expect(author?._resolved).toBe(true)
    expect(author?._cycle).not.toBe(true)
    expect(author?.document?.status).toBe('published')
    expect(author?.document?.fields?.bio).toBe('Published bio.')
  })

  it("status: 'any' populates the author's latest (draft) fields", async () => {
    const handle = ctx.client.collection(postsDefinition.path)
    const doc = await handle.findById<{ title: string; author: PopulatedLeaf }>(postId, {
      populate: { author: '*' },
      status: 'any',
    })

    expect(doc).not.toBeNull()
    const author = doc?.fields.author ?? null

    expect(author).not.toBeNull()
    expect(author?._resolved).toBe(true)
    expect(author?._cycle).not.toBe(true)
    expect(author?.document?.status).toBe('draft')
    expect(author?.document?.fields?.bio).toBe('In-progress draft bio.')
  })
})
