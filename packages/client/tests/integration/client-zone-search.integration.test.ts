/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Zone (cross-collection) search + hydrate — `client.search({ zone })`.
 *
 * Two collections index into the shared `site-<suffix>` zone: `articles`
 * (public, no beforeRead hook) and `notes` (tenant-scoped). Asserts:
 * heterogeneous ranked hits; per-collection ability filtering (a limited
 * actor sees only readable collections' hits, an actor with none gets the
 * ability error); beforeRead row scoping applies per collection through
 * the zone path; `hydrate` attaches shaped documents and drops stale index
 * entries; unknown zones throw.
 *
 * Uses the real `@byline/search-postgres` driver against `byline_test`.
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
// Test scaffolding — module-level current actor, swapped per test.
// ---------------------------------------------------------------------------

let currentRequestContext: RequestContext = makeSuperContext('super')

function makeSuperContext(id: string): RequestContext {
  return createRequestContext({
    actor: new AdminAuth({ id, abilities: [], isSuperAdmin: true }),
    readMode: 'any',
  })
}

function setSuperActor(id: string): void {
  currentRequestContext = makeSuperContext(id)
}

function setLimitedActor(id: string, abilities: string[]): void {
  currentRequestContext = createRequestContext({
    actor: new AdminAuth({ id, abilities, isSuperAdmin: false }),
    readMode: 'any',
  })
}

const suffix = `${Date.now()}-zone-search-${Math.floor(Math.random() * 1e6)}`
const zone = `site-${suffix}`
const articlesPath = `zone-articles-${suffix}`
const notesPath = `zone-notes-${suffix}`

// Tenant scoping on notes only — the actor id doubles as the tenant marker;
// 'super'-prefixed ids are unscoped.
const tenantScoping: BeforeReadHookFn = ({ requestContext }) => {
  const actor = requestContext.actor
  if (actor instanceof AdminAuth && actor.id.startsWith('super')) return
  const id = actor instanceof AdminAuth ? actor.id : '__none__'
  return { tenant: id } satisfies QueryPredicate
}

const articlesDefinition = defineCollection({
  path: articlesPath,
  labels: { singular: 'Article', plural: 'Articles' },
  useAsPath: 'title',
  useAsTitle: 'title',
  workflow: defineWorkflow({
    draft: { label: 'Draft', verb: 'Revert to Draft' },
    published: { label: 'Published', verb: 'Publish' },
  }),
  search: { zones: [zone], body: ['title'] },
  fields: [
    { name: 'title', type: 'text', label: 'Title' },
    { name: 'summary', type: 'text', label: 'Summary', optional: true },
  ],
})

const notesDefinition = defineCollection({
  path: notesPath,
  labels: { singular: 'Note', plural: 'Notes' },
  useAsPath: 'title',
  useAsTitle: 'title',
  workflow: defineWorkflow({
    draft: { label: 'Draft', verb: 'Revert to Draft' },
    published: { label: 'Published', verb: 'Publish' },
  }),
  search: { zones: [zone], body: ['title'] },
  fields: [
    { name: 'title', type: 'text', label: 'Title' },
    { name: 'tenant', type: 'text', label: 'Tenant' },
  ],
  hooks: { beforeRead: tenantScoping },
})

interface Ctx {
  client: BylineClient
  db: IDbAdapter
  articlesCollectionId: string
  notesCollectionId: string
}

let ctx: Ctx
let articleOne: string
let articleTwo: string
let noteAlice: string
let noteBob: string

beforeAll(async () => {
  const { client, db, collectionIds } = await setupMultiCollectionTestClient(
    [articlesDefinition, notesDefinition],
    {
      requestContext: () => currentRequestContext,
      search: (adapter) => {
        const pool = (adapter as unknown as { pool: Pool }).pool
        return postgresSearch({ pool, defaultLocale: 'en' })
      },
    }
  )
  await migrate((db as unknown as { pool: Pool }).pool)
  ctx = {
    client,
    db,
    articlesCollectionId: collectionIds[articlesPath] as string,
    notesCollectionId: collectionIds[notesPath] as string,
  }

  setSuperActor('super')
  const seed = async (collectionPath: string, fields: Record<string, string>): Promise<string> => {
    const handle = ctx.client.collection(collectionPath)
    const created = await handle.create(fields)
    await handle.changeStatus(created.documentId, 'published')
    await handle.indexDocument(created.documentId)
    return created.documentId
  }

  articleOne = await seed(articlesPath, { title: 'Zonal report one' })
  articleTwo = await seed(articlesPath, { title: 'Zonal report two' })
  noteAlice = await seed(notesPath, { title: 'Zonal report note', tenant: 'alice' })
  noteBob = await seed(notesPath, { title: 'Zonal report memo', tenant: 'bob' })
}, 30_000)

afterAll(async () => {
  for (const id of [ctx.articlesCollectionId, ctx.notesCollectionId]) {
    try {
      await ctx.db.commands.collections.delete(id)
    } catch (err) {
      console.error('Failed to delete zone-search collection:', err)
    }
  }
})

describe('zone (cross-collection) search', () => {
  it('returns heterogeneous hits ranked together across zone members', async () => {
    setSuperActor('super')
    const results = await ctx.client.search({ query: 'zonal', zone })

    expect(results.hits).toHaveLength(4)
    const paths = new Set(results.hits.map((h) => h.collectionPath))
    expect(paths.has(articlesPath)).toBe(true)
    expect(paths.has(notesPath)).toBe(true)
    expect(results.total).toBe(4)
  })

  it('throws ERR_VALIDATION for a zone no collection indexes into', async () => {
    setSuperActor('super')
    await expect(ctx.client.search({ query: 'zonal', zone: 'nope' })).rejects.toMatchObject({
      code: 'ERR_VALIDATION',
    })
  })

  it('applies beforeRead row scoping per collection through the zone path', async () => {
    setSuperActor('super') // seed state sanity is covered above; now scope:
    currentRequestContext = createRequestContext({
      actor: new AdminAuth({ id: 'alice', abilities: [], isSuperAdmin: true }),
      readMode: 'any',
    })
    const results = await ctx.client.search({ query: 'zonal', zone })

    const ids = new Set(results.hits.map((h) => h.documentId))
    // Articles have no hook — both pass. Notes are tenant-scoped to alice.
    expect(ids.has(articleOne)).toBe(true)
    expect(ids.has(articleTwo)).toBe(true)
    expect(ids.has(noteAlice)).toBe(true)
    expect(ids.has(noteBob)).toBe(false)
    expect(results.total).toBe(results.hits.length)
    expect(results.facets).toBeUndefined()
  })

  it('excludes collections the actor cannot read; errors only when none are readable', async () => {
    setLimitedActor('limited', [`collections.${articlesPath}.read`])
    const results = await ctx.client.search({ query: 'zonal', zone })
    const paths = new Set(results.hits.map((h) => h.collectionPath))
    expect(paths.has(articlesPath)).toBe(true)
    expect(paths.has(notesPath)).toBe(false)
    expect(results.total).toBe(results.hits.length)
    expect(results.facets).toBeUndefined()

    setLimitedActor('nobody', [])
    await expect(ctx.client.search({ query: 'zonal', zone })).rejects.toMatchObject({
      code: 'ERR_FORBIDDEN',
    })
  })

  it('hydrate attaches a shaped ClientDocument per hit', async () => {
    setSuperActor('super')
    const results = await ctx.client.search({ query: 'zonal', zone, hydrate: true })

    expect(results.hits.length).toBeGreaterThan(0)
    for (const hit of results.hits) {
      expect(hit.document).toBeDefined()
      expect(hit.document?.id).toBe(hit.documentId)
      expect(hit.document?.fields?.title).toBe(hit.title)
    }
  })

  it('collection-scoped search supports hydrate too', async () => {
    setSuperActor('super')
    const results = await ctx.client
      .collection(articlesPath)
      .search({ query: 'zonal', hydrate: true })
    expect(results.hits).toHaveLength(2)
    for (const hit of results.hits) {
      expect(hit.document?.fields?.title).toBe(hit.title)
    }
  })

  it('hydrate drops stale index entries whose document no longer resolves', async () => {
    // Delete an article *without* index maintenance (this collection wires no
    // lifecycle hooks), leaving a stale index row behind.
    setSuperActor('super')
    await ctx.client.collection(articlesPath).delete(articleTwo)

    const stale = await ctx.client.search({ query: 'zonal', zone })
    expect(stale.hits.some((h) => h.documentId === articleTwo)).toBe(true) // still ranked

    const hydrated = await ctx.client.search({ query: 'zonal', zone, hydrate: true })
    expect(hydrated.hits.some((h) => h.documentId === articleTwo)).toBe(false) // dropped
    expect(hydrated.hits.some((h) => h.documentId === articleOne)).toBe(true)
  })
})
