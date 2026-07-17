/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Exercises the document-tree invalidation contract: the `afterTreeChange`
 * collection hook fires once per structural write with the affected set, and a
 * document delete on a `tree: true` collection promotes the deleted node's
 * children to root (the soft-delete equivalent of the table's promote/cascade
 * foreign keys). See docs/04-collections/04-document-trees.md.
 */

import type { CollectionDefinition, TreeChangeContext } from '@byline/core'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  type MultiCollectionTestContext,
  setupMultiCollectionTestClient,
} from '../fixtures/setup.js'

const suffix = `${Date.now()}-treeevt-${Math.floor(Math.random() * 1e6)}`

// Captured `afterTreeChange` events, reset before each test.
const captured: TreeChangeContext[] = []

const treeDef: CollectionDefinition = {
  path: `tree-evt-${suffix}`,
  labels: { singular: 'Doc', plural: 'Docs' },
  useAsTitle: 'title',
  useAsPath: 'title',
  tree: true,
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
  hooks: {
    afterTreeChange: (ctx) => {
      captured.push(ctx)
    },
  },
}

let ctx: MultiCollectionTestContext

beforeAll(async () => {
  ctx = await setupMultiCollectionTestClient([treeDef])
}, 30_000)

afterAll(async () => {
  try {
    await ctx.db.commands.collections.delete(ctx.collectionIds[treeDef.path]!)
  } catch (err) {
    console.error('cleanup failed', err)
  }
})

beforeEach(() => {
  captured.length = 0
})

function tree() {
  return ctx.client.collection(treeDef.path)
}

let seq = 0
async function makeDoc(title: string): Promise<string> {
  const handle = tree()
  const slug = `${title.toLowerCase()}-${suffix}-${seq++}`
  const created = await handle.create({ title }, { path: slug })
  await handle.changeStatus(created.documentId, 'published')
  return created.documentId
}

describe('document-tree invalidation contract', () => {
  it('fires afterTreeChange on placement with the affected set', async () => {
    const handle = tree()
    const a = await makeDoc('EA')
    const b = await makeDoc('EB')
    const c = await makeDoc('EC')
    await handle.placeTreeNode(a, { parentDocumentId: null })
    await handle.placeTreeNode(b, { parentDocumentId: a })
    await handle.placeTreeNode(c, { parentDocumentId: null })

    captured.length = 0
    // Re-parent B from A to C.
    await handle.placeTreeNode(b, { parentDocumentId: c })

    expect(captured).toHaveLength(1)
    const evt = captured[0]!
    expect(evt.change).toBe('place')
    expect(evt.documentId).toBe(b)
    expect(evt.collectionPath).toBe(treeDef.path)
    // Affected: moved node, old parent, new parent (de-duplicated).
    expect(new Set(evt.affectedDocumentIds)).toEqual(new Set([b, a, c]))
  })

  it('includes descendants of the moved node in the affected set', async () => {
    const handle = tree()
    const root = await makeDoc('FR')
    const mid = await makeDoc('FM')
    const leaf = await makeDoc('FL')
    const dest = await makeDoc('FD')
    await handle.placeTreeNode(root, { parentDocumentId: null })
    await handle.placeTreeNode(mid, { parentDocumentId: root })
    await handle.placeTreeNode(leaf, { parentDocumentId: mid })
    await handle.placeTreeNode(dest, { parentDocumentId: null })

    captured.length = 0
    // Move `mid` (and its child `leaf`) under `dest`.
    await handle.placeTreeNode(mid, { parentDocumentId: dest })

    const affected = new Set(captured[0]?.affectedDocumentIds)
    expect(affected).toContain(mid)
    expect(affected).toContain(leaf) // descendant travels along
    expect(affected).toContain(root) // old parent
    expect(affected).toContain(dest) // new parent
  })

  it('fires afterTreeChange on removeFromTree', async () => {
    const handle = tree()
    const root = await makeDoc('GR')
    const kid = await makeDoc('GK')
    await handle.placeTreeNode(root, { parentDocumentId: null })
    await handle.placeTreeNode(kid, { parentDocumentId: root })

    captured.length = 0
    await handle.removeFromTree(kid)

    expect(captured).toHaveLength(1)
    expect(captured[0]?.change).toBe('remove')
    expect(captured[0]?.documentId).toBe(kid)
    expect(new Set(captured[0]?.affectedDocumentIds)).toEqual(new Set([kid, root]))
  })

  it('promotes children to root and fires the event when a parent is deleted', async () => {
    const handle = tree()
    const parent = await makeDoc('HP')
    const c1 = await makeDoc('HC1')
    const c2 = await makeDoc('HC2')
    await handle.placeTreeNode(parent, { parentDocumentId: null })
    await handle.placeTreeNode(c1, { parentDocumentId: parent })
    await handle.placeTreeNode(c2, { parentDocumentId: parent })

    // Before delete, the children's breadcrumb is [parent].
    expect((await handle.getAncestors(c1)).map((d) => d.id)).toEqual([parent])

    captured.length = 0
    await handle.delete(parent)

    // Children promoted to root — no ancestors now.
    expect(await handle.getAncestors(c1)).toEqual([])
    expect(await handle.getAncestors(c2)).toEqual([])

    // A single promote-on-delete event covering the deleted node + subtrees.
    const promote = captured.find((e) => e.change === 'promote-on-delete')
    expect(promote).toBeDefined()
    expect(promote?.documentId).toBe(parent)
    const affected = new Set(promote?.affectedDocumentIds)
    expect(affected).toContain(parent)
    expect(affected).toContain(c1)
    expect(affected).toContain(c2)
  })
})
