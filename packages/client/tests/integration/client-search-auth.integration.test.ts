/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Row-level authorization on search — "rank in the provider, authorise in
 * core". A tenant-scoped collection (`beforeRead` returns a tenant
 * predicate) indexes documents from two tenants; the provider ranks across
 * the whole published index, and `CollectionHandle.search` must re-resolve
 * the candidate ids through the normal read path so an actor only receives
 * hits their scoping permits.
 *
 * Pins the documented approximations too: `total` stays the provider's
 * pre-authorization count, and `_bypassBeforeRead: true` is the system
 * escape hatch.
 *
 * Uses the real `@byline/search-postgres` driver against `byline_test`
 * (its schema migrates into the same database, own migrations table).
 */

import { AdminAuth, createRequestContext, type RequestContext } from '@byline/auth'
import type { BeforeReadHookFn, IDbAdapter, QueryPredicate } from '@byline/core'
import { defineCollection, defineWorkflow } from '@byline/core'
import { migrate, postgresSearch } from '@byline/search-postgres'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupMultiCollectionTestClient } from '../fixtures/setup.js'
import type { BylineClient } from '../../src/index.js'

// ---------------------------------------------------------------------------
// Test scaffolding — module-level current actor, swapped per test (the
// client's requestContext is a factory that reads this on every call).
// ---------------------------------------------------------------------------

let currentRequestContext: RequestContext = makeActorContext('super')

function makeActorContext(id: string): RequestContext {
  return createRequestContext({
    actor: new AdminAuth({
      id,
      abilities: [],
      isSuperAdmin: true, // bypass the collection-read ability; isolate row scoping
    }),
    readMode: 'any',
  })
}

function setActor(id: string): void {
  currentRequestContext = makeActorContext(id)
}

const suffix = `${Date.now()}-search-auth-${Math.floor(Math.random() * 1e6)}`

// Tenant scoping — the actor id doubles as the tenant marker; the 'super'
// actor is unscoped (hook returns void → no second query on search).
const tenantScoping: BeforeReadHookFn = ({ requestContext }) => {
  const actor = requestContext.actor
  if (actor instanceof AdminAuth && actor.id === 'super') return
  const id = actor instanceof AdminAuth ? actor.id : '__none__'
  return { tenant: id } satisfies QueryPredicate
}

const notesDefinition = defineCollection({
  path: `search-auth-notes-${suffix}`,
  labels: { singular: 'Note', plural: 'Notes' },
  useAsPath: 'title',
  useAsTitle: 'title',
  workflow: defineWorkflow({
    draft: { label: 'Draft', verb: 'Revert to Draft' },
    published: { label: 'Published', verb: 'Publish' },
  }),
  search: { body: ['title'] },
  fields: [
    { name: 'title', type: 'text', label: 'Title' },
    { name: 'tenant', type: 'text', label: 'Tenant' },
  ],
  hooks: { beforeRead: tenantScoping },
})

interface Ctx {
  client: BylineClient
  db: IDbAdapter
  collectionId: string
}

let ctx: Ctx
let aliceOne: string
let aliceTwo: string
let bobOne: string

beforeAll(async () => {
  const { client, db, collectionIds } = await setupMultiCollectionTestClient([notesDefinition], {
    requestContext: () => currentRequestContext,
    search: (adapter) => {
      const pool = (adapter as unknown as { pool: Pool }).pool
      return postgresSearch({ pool, defaultLocale: 'en' })
    },
  })
  // Deterministic schema setup (autoMigrate is fire-and-forget by design).
  await migrate((db as unknown as { pool: Pool }).pool)
  ctx = { client, db, collectionId: collectionIds[notesDefinition.path] as string }

  const notes = ctx.client.collection(notesDefinition.path)
  const seed = async (title: string, tenant: string): Promise<string> => {
    const created = await notes.create({ title, tenant })
    await notes.changeStatus(created.documentId, 'published')
    // Indexing is a system operation (reads bypass row scoping) — the index
    // deliberately holds every published document across tenants.
    await notes.indexDocument(created.documentId)
    return created.documentId
  }

  setActor('super')
  aliceOne = await seed('Quarterly report alpha', 'alice')
  aliceTwo = await seed('Quarterly report omega', 'alice')
  bobOne = await seed('Quarterly report beta', 'bob')
}, 30_000)

afterAll(async () => {
  try {
    await ctx.db.commands.collections.delete(ctx.collectionId)
  } catch (err) {
    console.error('Failed to delete search-auth collection:', err)
  }
})

describe('search row-level authorization (beforeRead re-resolution)', () => {
  it('rejects anonymous published contexts requesting status:any', async () => {
    currentRequestContext = createRequestContext({ actor: null, readMode: 'published' })
    await expect(
      ctx.client.collection(notesDefinition.path).search({ query: 'report', status: 'any' })
    ).rejects.toMatchObject({ code: 'ERR_UNAUTHENTICATED' })
  })

  it('drops hits the actor’s row scoping does not permit', async () => {
    setActor('alice')
    const results = await ctx.client.collection(notesDefinition.path).search({ query: 'report' })

    const ids = new Set(results.hits.map((h) => h.documentId))
    expect(ids.has(aliceOne)).toBe(true)
    expect(ids.has(aliceTwo)).toBe(true)
    expect(ids.has(bobOne)).toBe(false)
    expect(results.hits).toHaveLength(2)
  })

  it('does not expose the provider total when row authorization applies', async () => {
    setActor('alice')
    const results = await ctx.client.collection(notesDefinition.path).search({ query: 'report' })
    expect(results.total).toBe(2)
    expect(results.hits).toHaveLength(2)
    expect(results.facets).toBeUndefined()
  })

  it('returns nothing for an actor whose scoping matches no rows', async () => {
    setActor('carol')
    const results = await ctx.client.collection(notesDefinition.path).search({ query: 'report' })
    expect(results.hits).toHaveLength(0)
  })

  it('skips the second query when the hook applies no scoping (unscoped actor sees all hits)', async () => {
    setActor('super')
    const results = await ctx.client.collection(notesDefinition.path).search({ query: 'report' })
    expect(results.hits).toHaveLength(3)
  })

  it('honours the `_bypassBeforeRead` system escape hatch', async () => {
    setActor('alice')
    const results = await ctx.client
      .collection(notesDefinition.path)
      .search({ query: 'report', _bypassBeforeRead: true })
    expect(results.hits).toHaveLength(3)
  })
})
