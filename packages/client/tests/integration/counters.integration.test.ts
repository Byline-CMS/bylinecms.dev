/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createSuperAdminContext } from '@byline/auth'
import {
  type BylineLogger,
  type CollectionDefinition,
  defineCollection,
  defineWorkflow,
  discoverCounterGroups,
  duplicateDocument,
} from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupMultiCollectionTestClient } from '../fixtures/setup.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Append a per-file random suffix so parallel test files can't collide on
// the collections.path unique key. The counter `group` itself is the
// literal 'shared-counters' — sequences are durable across test runs, so
// every assertion in this file is *relative* (distinctness, monotonicity)
// rather than absolute (no "first value === 1" expectations).
const testSuffix = `${Date.now()}-counters-${Math.floor(Math.random() * 1e6)}`

const COUNTER_GROUP = 'shared-counters'

function defineTermCollection(name: string): CollectionDefinition {
  return defineCollection({
    path: `test-${name}-${testSuffix}`,
    labels: { singular: name, plural: `${name}s` },
    workflow: defineWorkflow({
      draft: { label: 'Draft', verb: 'Revert to Draft' },
      published: { label: 'Published', verb: 'Publish' },
      archived: { label: 'Archived', verb: 'Archive' },
    }),
    useAsPath: 'label',
    fields: [
      { name: 'label', type: 'text', label: 'Label' },
      { name: 'facetId', type: 'counter', group: COUNTER_GROUP },
    ],
  })
}

const topicsDef = defineTermCollection('topic')
const formatsDef = defineTermCollection('format')
const geographyDef = defineTermCollection('geography')

interface Ctx {
  client: Awaited<ReturnType<typeof setupMultiCollectionTestClient>>['client']
  db: Awaited<ReturnType<typeof setupMultiCollectionTestClient>>['db']
  collectionIds: Record<string, string>
}

let ctx: Ctx

// The any-status read override — Phase 5 defaults to 'published', and
// we're reading freshly-created drafts here.
const any = { status: 'any' as const }

beforeAll(async () => {
  const { client, db, collectionIds } = await setupMultiCollectionTestClient([
    topicsDef,
    formatsDef,
    geographyDef,
  ])

  // The integration setup bypasses initBylineCore — it constructs the
  // adapter and registers the collection rows directly. Run the counter
  // group discovery pass manually here so the 'shared-counters' sequence
  // is registered before any document create touches nextCounterValue.
  await discoverCounterGroups({
    definitions: [topicsDef, formatsDef, geographyDef],
    db,
  })

  ctx = { client, db, collectionIds }
}, 30_000)

afterAll(async () => {
  if (!ctx) return
  for (const id of Object.values(ctx.collectionIds)) {
    try {
      await ctx.db.commands.collections.delete(id)
    } catch (err) {
      console.error('Failed to delete test collection:', err)
    }
  }
  // The 'shared-counters' sequence is intentionally left in place across
  // test runs: it's durable, it costs nothing, and recreating it would
  // require dropping it on every teardown — which would require coordination
  // if multiple test files ever share the group.
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readFacetId(collectionPath: string, documentId: string): Promise<number> {
  const doc = await ctx.client.collection(collectionPath).findById(documentId, any)
  if (!doc) throw new Error(`Document ${documentId} not found in ${collectionPath}`)
  const value = (doc.fields as Record<string, unknown>).facetId
  if (typeof value !== 'number') {
    throw new Error(
      `facetId on ${collectionPath}/${documentId} is not a number: ${JSON.stringify(value)}`
    )
  }
  return value
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('counter field (group: shared-counters)', () => {
  it('assigns a positive integer to every freshly-created document', async () => {
    const topic = await ctx.client
      .collection(topicsDef.path)
      .create({ label: `Forestry-${testSuffix}` })

    const value = await readFacetId(topicsDef.path, topic.documentId)
    expect(Number.isInteger(value)).toBe(true)
    expect(value).toBeGreaterThan(0)
  })

  it('allocates distinct, monotonically-increasing values across interleaved cross-collection creates', async () => {
    // Create in interleaved order: topic, format, topic, geography, format.
    // The sequence is shared, so each value should be strictly greater
    // than the previous regardless of which collection it landed in.
    const created = [
      { col: topicsDef.path, label: `Genetics-${testSuffix}` },
      { col: formatsDef.path, label: `Thesis-${testSuffix}` },
      { col: topicsDef.path, label: `Biodiversity-${testSuffix}` },
      { col: geographyDef.path, label: `Laos-${testSuffix}` },
      { col: formatsDef.path, label: `Research Paper-${testSuffix}` },
    ]

    const ids: number[] = []
    for (const seed of created) {
      const { documentId } = await ctx.client.collection(seed.col).create({ label: seed.label })
      ids.push(await readFacetId(seed.col, documentId))
    }

    // Distinct
    expect(new Set(ids).size).toBe(ids.length)
    // Monotonically increasing
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBeGreaterThan(ids[i - 1] as number)
    }
  })

  it('preserves the counter value across an update to the same document', async () => {
    const handle = ctx.client.collection(topicsDef.path)
    const created = await handle.create({ label: `Nursery-${testSuffix}` })
    const before = await readFacetId(topicsDef.path, created.documentId)

    await handle.update(created.documentId, {
      label: `Nursery Techniques-${testSuffix}`,
    })

    const after = await readFacetId(topicsDef.path, created.documentId)
    expect(after).toBe(before)
  })

  it('ignores a caller-supplied counter value on update (immutable contract)', async () => {
    const handle = ctx.client.collection(topicsDef.path)
    const created = await handle.create({ label: `Soil Science-${testSuffix}` })
    const before = await readFacetId(topicsDef.path, created.documentId)

    // The client API technically accepts arbitrary keys in the data
    // object — the lifecycle layer is the one that enforces immutability.
    await handle.update(created.documentId, {
      label: `Soil-${testSuffix}`,
      facetId: 999_999 as unknown as never,
    } as never)

    const after = await readFacetId(topicsDef.path, created.documentId)
    expect(after).toBe(before)
    expect(after).not.toBe(999_999)
  })

  it('filters documents by facetId via where.in within a single collection', async () => {
    // Seed three deterministic topics, capture their assigned IDs.
    const handle = ctx.client.collection(topicsDef.path)
    const a = await handle.create({ label: `FilterA-${testSuffix}` })
    const b = await handle.create({ label: `FilterB-${testSuffix}` })
    const c = await handle.create({ label: `FilterC-${testSuffix}` })

    const ids = [
      await readFacetId(topicsDef.path, a.documentId),
      await readFacetId(topicsDef.path, b.documentId),
      await readFacetId(topicsDef.path, c.documentId),
    ]

    // Query for two of the three IDs.
    const target = [ids[0]!, ids[2]!]
    const result = await ctx.client.collection(topicsDef.path).find({
      where: { facetId: { $in: target } },
      ...any,
    })

    const labels = result.docs.map((d) => (d.fields as Record<string, unknown>).label).sort()
    expect(labels).toEqual([`FilterA-${testSuffix}`, `FilterC-${testSuffix}`].sort())
  })

  it('assigns a fresh counter value to a duplicated document (source unchanged)', async () => {
    // Duplicate isn't exposed via @byline/client today, so we go through
    // the lifecycle service directly. Constructing the context manually
    // mirrors what host-tanstack-start's server fns do per-request.
    const definition = topicsDef
    const collectionId = ctx.collectionIds[definition.path]!
    const noop = () => {}
    const logger: BylineLogger = {
      log: noop,
      fatal: noop,
      error: noop,
      warn: noop,
      info: noop,
      debug: noop,
      trace: noop,
      silent: noop,
    }

    const source = await ctx.client
      .collection(definition.path)
      .create({ label: `Original-${testSuffix}` })
    const sourceFacetId = await readFacetId(definition.path, source.documentId)

    const dup = await duplicateDocument(
      {
        db: ctx.db,
        definition,
        collectionId,
        collectionVersion: 1,
        collectionPath: definition.path,
        defaultLocale: 'en',
        logger,
        requestContext: createSuperAdminContext({ id: 'test-super-admin' }),
      },
      { sourceDocumentId: source.documentId }
    )

    const dupFacetId = await readFacetId(definition.path, dup.documentId)
    expect(dupFacetId).not.toBe(sourceFacetId)
    expect(dupFacetId).toBeGreaterThan(sourceFacetId)

    // Source must be untouched.
    const sourceFacetIdAfter = await readFacetId(definition.path, source.documentId)
    expect(sourceFacetIdAfter).toBe(sourceFacetId)
  })
})
