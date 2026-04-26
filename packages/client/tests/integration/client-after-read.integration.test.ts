/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Integration coverage for the `afterRead` collection hook against a real
 * Postgres instance. Asserts:
 *   - the hook fires on findById / findByPath / find
 *   - mutations to `ctx.doc.fields` propagate into the shaped response
 *   - per-request dedup via ReadContext (the A→B→A guard)
 */

import type { AfterReadContext, CollectionDefinition } from '@byline/core'
import { createReadContext, defineWorkflow } from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupTestClient, type TestContext, teardownTestClient } from '../fixtures/setup.js'

// Shared log — tests reset by re-assigning .length = 0.
const hookCalls: AfterReadContext[] = []

function testCollection(suffix: string | number): CollectionDefinition {
  return {
    path: `after-read-${suffix}`,
    labels: { singular: 'AR Article', plural: 'AR Articles' },
    workflow: defineWorkflow({
      draft: { label: 'Draft', verb: 'Revert to Draft' },
      published: { label: 'Published', verb: 'Publish' },
      archived: { label: 'Archived', verb: 'Archive' },
    }),
    search: { fields: ['title'] },
    useAsTitle: 'title',
    // Slugify the `path` field into the version path so the `findByPath`
    // test resolves docs by the value supplied in `data.path`.
    useAsPath: 'path',
    fields: [
      { name: 'title', type: 'text', label: 'Title' },
      { name: 'path', type: 'text', label: 'Path' },
      { name: 'secret', type: 'text', label: 'Secret', optional: true },
    ],
    hooks: {
      afterRead: (ctx: AfterReadContext) => {
        hookCalls.push(ctx)
        // Compute a derived field so we can assert mutation propagation.
        ctx.doc.fields.computedTitle = `${ctx.doc.fields.title}!!`
      },
    },
  }
}

let ctx: TestContext
const testSuffix = `${Date.now()}-after-read-${Math.floor(Math.random() * 1e6)}`

beforeAll(async () => {
  const definition = testCollection(testSuffix)
  ctx = await setupTestClient(definition)
}, 30_000)

afterAll(async () => {
  await teardownTestClient(ctx)
})

describe('afterRead integration', () => {
  it('fires on findById and mutations propagate into the shaped response', async () => {
    const handle = ctx.client.collection(ctx.definition.path)

    const { documentId } = await handle.create({
      title: 'Original',
      path: 'ar-findbyid',
      secret: 'visible',
    })
    await handle.changeStatus(documentId, 'published')

    hookCalls.length = 0
    const doc = await handle.findById(documentId)

    expect(hookCalls.length).toBe(1)
    expect(hookCalls[0]?.collectionPath).toBe(ctx.definition.path)
    expect(doc?.fields.computedTitle).toBe('Original!!')
  })

  it('fires on findByPath', async () => {
    const handle = ctx.client.collection(ctx.definition.path)

    const { documentId } = await handle.create({
      title: 'By Path',
      path: 'ar-bypath',
      secret: 'visible',
    })
    await handle.changeStatus(documentId, 'published')

    hookCalls.length = 0
    const doc = await handle.findByPath('ar-bypath')

    expect(hookCalls.length).toBe(1)
    expect(doc?.fields.computedTitle).toBe('By Path!!')
  })

  it('fires once per doc on find() list results', async () => {
    const handle = ctx.client.collection(ctx.definition.path)
    for (let i = 0; i < 2; i++) {
      const { documentId } = await handle.create({
        title: `List ${i}`,
        path: `ar-list-${i}`,
        secret: 'visible',
      })
      await handle.changeStatus(documentId, 'published')
    }

    hookCalls.length = 0
    const result = await handle.find()

    expect(hookCalls.length).toBe(result.docs.length)
    expect(hookCalls.length).toBeGreaterThanOrEqual(2)
    for (const doc of result.docs) {
      expect(doc.fields.computedTitle).toBe(`${doc.fields.title}!!`)
    }
  })

  it('dedups within a single ReadContext across multiple top-level calls', async () => {
    const handle = ctx.client.collection(ctx.definition.path)

    const { documentId } = await handle.create({
      title: 'Dedup',
      path: 'ar-dedup',
      secret: 'visible',
    })
    await handle.changeStatus(documentId, 'published')

    hookCalls.length = 0
    const rc = createReadContext()

    await handle.findById(documentId, { _readContext: rc })
    await handle.findById(documentId, { _readContext: rc })
    await handle.findById(documentId, { _readContext: rc })

    // All three top-level calls share the ReadContext, so afterRead fires
    // only on the first — the A→B→A guard in action.
    expect(hookCalls.length).toBe(1)
  })

  it('fires once per top-level call when no shared ReadContext', async () => {
    const handle = ctx.client.collection(ctx.definition.path)

    const { documentId } = await handle.create({
      title: 'Fresh',
      path: 'ar-fresh',
      secret: 'visible',
    })
    await handle.changeStatus(documentId, 'published')

    hookCalls.length = 0
    await handle.findById(documentId)
    await handle.findById(documentId)

    expect(hookCalls.length).toBe(2)
  })
})
