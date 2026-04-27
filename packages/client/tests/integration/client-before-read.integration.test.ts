/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * End-to-end verification of the `beforeRead` hook against a real
 * Postgres instance. Closes the integration gap left by Phases 7.1–7.4
 * (which were unit-covered): the predicate compiler, the per-request
 * cache, the populate-fanout dedup, and the `_bypassBeforeRead` escape
 * hatch all need to behave correctly when the SQL actually runs.
 *
 * Doubles as a worked example for the recipes in
 * `docs/analysis/ACCESS-CONTROL-RECIPES.md` — Recipe 1 (owner-only
 * drafts) is wired on the `posts` collection here, Recipe 2 (multi-
 * tenant scoping) on `authors`. Each scenario below demonstrates one
 * of the recipe patterns end-to-end.
 *
 * Two collections (posts → author) so the populate-fanout test has
 * something to fan out across. Wired inline because the shared
 * `setupTestClient` fixture is single-collection.
 */

import {
  AdminAuth,
  createRequestContext,
  createSuperAdminContext,
  type RequestContext,
} from '@byline/auth'
import type {
  BeforeReadHookFn,
  CollectionDefinition,
  IDbAdapter,
  QueryPredicate,
} from '@byline/core'
import { defineCollection, defineWorkflow } from '@byline/core'
import { pgAdapter } from '@byline/db-postgres'
import 'dotenv/config'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { type BylineClient, createBylineClient } from '../../src/index.js'

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

// Module-level current-actor reference, swapped by tests via `setActor`.
// The client's `requestContext` is a factory that reads this on every call,
// so a single client services all of the actor permutations below.
let currentRequestContext: RequestContext = createSuperAdminContext({ id: 'test-super-admin' })

function setActor(authorId: string | null): void {
  if (authorId === null) {
    currentRequestContext = createRequestContext({ actor: null, readMode: 'any' })
    return
  }
  currentRequestContext = createRequestContext({
    actor: new AdminAuth({
      id: authorId,
      abilities: [],
      isSuperAdmin: true, // bypass collection-read ability; isolate beforeRead behaviour
    }),
    readMode: 'any',
  })
}

// Hook-call counter for the populate-fanout cache test. Reset per test.
let hookInvocations: { collectionPath: string; actorId: string | null }[] = []

const suffix = `${Date.now()}-bef-read-${Math.floor(Math.random() * 1e6)}`

// ---------------------------------------------------------------------------
// Collection definitions
// ---------------------------------------------------------------------------

// Recipe 1 — owner-only drafts.
const ownerOnlyDrafts: BeforeReadHookFn = ({ requestContext, collectionPath }) => {
  hookInvocations.push({
    collectionPath,
    actorId: requestContext.actor instanceof AdminAuth ? requestContext.actor.id : null,
  })
  // Super-admin in the test wiring → no scoping. Look at the *id* rather
  // than `isSuperAdmin` so the test can exercise both branches with the
  // same actor class.
  const actor = requestContext.actor
  if (actor instanceof AdminAuth && actor.id === 'super') return
  const id = actor instanceof AdminAuth ? actor.id : '__none__'
  return {
    $or: [{ status: 'published' }, { status: 'draft', authorId: id }],
  } satisfies QueryPredicate
}

// Recipe 2 — tenant scoping. Encoded as an `$or` rather than a simple
// equality so we can assert that combinator predicates compile correctly
// through the populate path too.
const tenantScoping: BeforeReadHookFn = ({ requestContext, collectionPath }) => {
  hookInvocations.push({
    collectionPath,
    actorId: requestContext.actor instanceof AdminAuth ? requestContext.actor.id : null,
  })
  const actor = requestContext.actor
  if (actor instanceof AdminAuth && actor.id === 'super') return
  // `authorId` doubles as a tenant marker on this collection so we can
  // reuse the AdminAuth.id slot — the test wiring's `id` is one of
  // 'alice' / 'bob' / 'super'.
  const id = actor instanceof AdminAuth ? actor.id : '__none__'
  return { tenantId: id } satisfies QueryPredicate
}

const authorsDefinition = defineCollection({
  path: `bef-read-authors-${suffix}`,
  labels: { singular: 'Author', plural: 'Authors' },
  useAsPath: 'name',
  workflow: defineWorkflow({
    draft: { label: 'Draft', verb: 'Revert to Draft' },
    published: { label: 'Published', verb: 'Publish' },
  }),
  fields: [
    { name: 'name', type: 'text', label: 'Name' },
    { name: 'tenantId', type: 'text', label: 'Tenant' },
  ],
  hooks: { beforeRead: tenantScoping },
})

const postsDefinition = defineCollection({
  path: `bef-read-posts-${suffix}`,
  labels: { singular: 'Post', plural: 'Posts' },
  useAsPath: 'title',
  workflow: defineWorkflow({
    draft: { label: 'Draft', verb: 'Revert to Draft' },
    published: { label: 'Published', verb: 'Publish' },
  }),
  fields: [
    { name: 'title', type: 'text', label: 'Title' },
    { name: 'authorId', type: 'text', label: 'Author Id' },
    {
      name: 'author',
      type: 'relation',
      label: 'Author',
      targetCollection: `bef-read-authors-${suffix}`,
      optional: true,
    },
  ],
  hooks: { beforeRead: ownerOnlyDrafts },
})

interface Ctx {
  client: BylineClient
  db: IDbAdapter
  authorsCollectionId: string
  postsCollectionId: string
}

let ctx: Ctx

async function setup(): Promise<Ctx> {
  const connectionString = process.env.POSTGRES_CONNECTION_STRING
  if (!connectionString) {
    throw new Error(
      'POSTGRES_CONNECTION_STRING is not set. Copy .env.example to .env and configure it.'
    )
  }

  const collections: CollectionDefinition[] = [authorsDefinition, postsDefinition]
  const db = pgAdapter({ connectionString, collections })

  const client = createBylineClient({
    db,
    collections,
    requestContext: () => currentRequestContext,
  })

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

async function teardown(c: Ctx): Promise<void> {
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

// ---------------------------------------------------------------------------
// Seed: built once in beforeAll, shared across tests. Each test resets
// the actor + the hook counter; nothing mutates seeded data.
// ---------------------------------------------------------------------------

let aliceDraftId: string
let bobDraftId: string
let alicePublishedId: string
let aliceAuthorId: string

beforeAll(async () => {
  ctx = await setup()
  setActor(null) // super-admin context is reset above
  currentRequestContext = createSuperAdminContext({ id: 'super' })

  // Seed an author per tenant (alice / bob).
  const aliceAuthor = await ctx.client
    .collection(authorsDefinition.path)
    .create({ name: 'Alice', tenantId: 'alice' })
  aliceAuthorId = aliceAuthor.documentId
  await ctx.client.collection(authorsDefinition.path).changeStatus(aliceAuthorId, 'published')

  const bobAuthor = await ctx.client
    .collection(authorsDefinition.path)
    .create({ name: 'Bob', tenantId: 'bob' })
  await ctx.client
    .collection(authorsDefinition.path)
    .changeStatus(bobAuthor.documentId, 'published')

  // Three posts: alice's draft, bob's draft, alice's published.
  // Each post links to the alice-author so the populate fanout can be
  // exercised regardless of which post is fetched.
  const aliceDraft = await ctx.client.collection(postsDefinition.path).create({
    title: 'Alice draft',
    authorId: 'alice',
    author: { targetDocumentId: aliceAuthorId, targetCollectionId: ctx.authorsCollectionId },
  })
  aliceDraftId = aliceDraft.documentId

  const bobDraft = await ctx.client.collection(postsDefinition.path).create({
    title: 'Bob draft',
    authorId: 'bob',
    author: { targetDocumentId: aliceAuthorId, targetCollectionId: ctx.authorsCollectionId },
  })
  bobDraftId = bobDraft.documentId

  const alicePub = await ctx.client.collection(postsDefinition.path).create({
    title: 'Alice published',
    authorId: 'alice',
    author: { targetDocumentId: aliceAuthorId, targetCollectionId: ctx.authorsCollectionId },
  })
  alicePublishedId = alicePub.documentId
  await ctx.client.collection(postsDefinition.path).changeStatus(alicePublishedId, 'published')
}, 60_000)

afterAll(async () => {
  await teardown(ctx)
})

beforeEach(() => {
  hookInvocations = []
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('beforeRead — find', () => {
  it("alice sees her own drafts plus everyone's published", async () => {
    setActor('alice')
    const result = await ctx.client.collection(postsDefinition.path).find({ status: 'any' })
    const titles = result.docs.map((d) => d.fields.title).sort()
    expect(titles).toEqual(['Alice draft', 'Alice published'])
  })

  it("bob sees his own drafts plus everyone's published", async () => {
    setActor('bob')
    const result = await ctx.client.collection(postsDefinition.path).find({ status: 'any' })
    const titles = result.docs.map((d) => d.fields.title).sort()
    expect(titles).toEqual(['Alice published', 'Bob draft'])
  })

  it('user with the super branch sees all rows (hook returns void)', async () => {
    setActor(null)
    currentRequestContext = createSuperAdminContext({ id: 'super' })
    const result = await ctx.client.collection(postsDefinition.path).find({ status: 'any' })
    expect(result.docs).toHaveLength(3)
  })

  it('the predicate AND-merges with a caller-supplied where', async () => {
    setActor('alice')
    // Caller filters to drafts only; predicate further narrows to alice's
    // drafts. Combined: alice's drafts only.
    const result = await ctx.client
      .collection(postsDefinition.path)
      .find({ status: 'any', where: { status: 'draft' } })
    const titles = result.docs.map((d) => d.fields.title)
    expect(titles).toEqual(['Alice draft'])
  })
})

describe('beforeRead — findById', () => {
  it('returns null when the predicate excludes the row', async () => {
    setActor('alice')
    const bobDraft = await ctx.client
      .collection(postsDefinition.path)
      .findById(bobDraftId, { status: 'any' })
    expect(bobDraft).toBeNull()
  })

  it('returns the row when the predicate admits it', async () => {
    setActor('alice')
    const aliceDraft = await ctx.client
      .collection(postsDefinition.path)
      .findById(aliceDraftId, { status: 'any' })
    expect(aliceDraft?.fields.title).toBe('Alice draft')
  })
})

describe('beforeRead — _bypassBeforeRead', () => {
  it('skips the hook and returns the unscoped row', async () => {
    setActor('alice')
    const bobDraft = await ctx.client
      .collection(postsDefinition.path)
      .findById(bobDraftId, { status: 'any', _bypassBeforeRead: true })
    expect(bobDraft?.fields.title).toBe('Bob draft')
    expect(hookInvocations.find((i) => i.collectionPath === postsDefinition.path)).toBeUndefined()
  })

  it('also skips the hook on find()', async () => {
    setActor('alice')
    const result = await ctx.client
      .collection(postsDefinition.path)
      .find({ status: 'any', _bypassBeforeRead: true })
    expect(result.docs).toHaveLength(3)
  })
})

describe('beforeRead — populate fanout cache', () => {
  it('runs the target hook once per request even across multiple source docs', async () => {
    setActor('alice')
    const result = await ctx.client.collection(postsDefinition.path).find({
      status: 'any',
      populate: '*',
    })
    // Source collection: posts. Target collection: authors. Each hook
    // should fire exactly once per request — caching on
    // `readContext.beforeReadCache` is what guarantees this regardless
    // of how many posts the find returns.
    const postsCalls = hookInvocations.filter((i) => i.collectionPath === postsDefinition.path)
    const authorsCalls = hookInvocations.filter((i) => i.collectionPath === authorsDefinition.path)
    expect(postsCalls).toHaveLength(1)
    expect(authorsCalls).toHaveLength(1)
    // Sanity: alice should have got back her own visible posts and the
    // populated author should be tenant=alice (which is the only
    // author her tenant predicate admits).
    expect(result.docs.length).toBeGreaterThan(0)
    for (const post of result.docs) {
      const author = post.fields.author as Record<string, any> | null
      if (author?._resolved) {
        expect(author.document?.fields.tenantId).toBe('alice')
      }
    }
  })

  it('bob populating sees his own tenant only — alice author becomes unresolved', async () => {
    setActor('bob')
    const result = await ctx.client.collection(postsDefinition.path).find({
      status: 'any',
      populate: '*',
    })
    for (const post of result.docs) {
      const author = post.fields.author as Record<string, any> | null
      // Bob's tenant predicate excludes the alice author, so the
      // relation envelope drops to `_resolved: false` rather than
      // surfacing a tenant=alice document.
      if (author) {
        expect(author._resolved).toBe(false)
      }
    }
  })
})

describe('beforeRead — countByStatus', () => {
  it("counts reflect the actor's predicate", async () => {
    setActor('alice')
    const counts = await ctx.client.collection(postsDefinition.path).countByStatus()
    // Alice can see: her own draft + alice published. Bob's draft is invisible.
    const total = counts.reduce((s, c) => s + c.count, 0)
    expect(total).toBe(2)
    const draftCount = counts.find((c) => c.status === 'draft')?.count ?? 0
    expect(draftCount).toBe(1)
  })
})

describe('beforeRead — history access gate', () => {
  it("returns empty when the actor's predicate excludes the document", async () => {
    setActor('alice')
    const result = await ctx.client.collection(postsDefinition.path).history(bobDraftId)
    expect(result.docs).toEqual([])
  })

  it('returns history when the actor can read the document', async () => {
    setActor('alice')
    const result = await ctx.client.collection(postsDefinition.path).history(aliceDraftId)
    expect(result.docs.length).toBeGreaterThan(0)
  })
})
