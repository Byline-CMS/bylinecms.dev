/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Exercises the `@byline/client` document-tree API (`placeTreeNode`,
 * `removeFromTree`, `getSubtree`, `getAncestors`) end-to-end against the live
 * `byline_test` Postgres. Verifies the nested hydration, root-first ancestor
 * walk, status-at-edge subtree hiding, and the `tree: true` guard.
 * See docs/04-collections/04-document-trees.md.
 */

import type { CollectionDefinition } from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  type MultiCollectionTestContext,
  setupMultiCollectionTestClient,
} from '../fixtures/setup.js'

const suffix = `${Date.now()}-tree-${Math.floor(Math.random() * 1e6)}`

const treeDef: CollectionDefinition = {
  path: `tree-docs-${suffix}`,
  labels: { singular: 'Doc', plural: 'Docs' },
  useAsTitle: 'title',
  useAsPath: 'title',
  tree: true,
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
}

const plainDef: CollectionDefinition = {
  path: `tree-plain-${suffix}`,
  labels: { singular: 'Plain', plural: 'Plains' },
  useAsPath: 'title',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
}

let ctx: MultiCollectionTestContext

beforeAll(async () => {
  ctx = await setupMultiCollectionTestClient([treeDef, plainDef])
}, 30_000)

afterAll(async () => {
  for (const def of [treeDef, plainDef]) {
    try {
      await ctx.db.commands.collections.delete(ctx.collectionIds[def.path]!)
    } catch (err) {
      console.error('cleanup failed', err)
    }
  }
})

function tree() {
  return ctx.client.collection(treeDef.path)
}

let seq = 0
async function makeDoc(title: string, publish = true): Promise<string> {
  const handle = tree()
  const slug = `${title.toLowerCase().replace(/\s+/g, '-')}-${suffix}-${seq++}`
  const created = await handle.create({ title }, { path: slug })
  if (publish) await handle.changeStatus(created.documentId, 'published')
  return created.documentId
}

describe('client document-tree API', () => {
  it('places nodes and reads them back as a nested, ordered subtree', async () => {
    const handle = tree()
    const guide = await makeDoc('Guide')
    const intro = await makeDoc('Intro')
    const advanced = await makeDoc('Advanced')
    const cli = await makeDoc('CLI')

    await handle.placeTreeNode(guide, { parentDocumentId: null })
    await handle.placeTreeNode(intro, { parentDocumentId: guide })
    await handle.placeTreeNode(advanced, { parentDocumentId: guide, beforeDocumentId: intro })
    await handle.placeTreeNode(cli, { parentDocumentId: advanced })

    const forest = await handle.getSubtree({ rootDocumentId: guide })
    expect(forest).toHaveLength(1)

    const root = forest[0]!
    expect(root.document.fields.title).toBe('Guide')
    expect(root.depth).toBe(0)
    expect(root.children.map((c) => c.document.fields.title)).toEqual(['Intro', 'Advanced'])

    const advancedNode = root.children.find((c) => c.document.fields.title === 'Advanced')!
    expect(advancedNode.depth).toBe(1)
    expect(advancedNode.children.map((c) => c.document.fields.title)).toEqual(['CLI'])
    expect(advancedNode.children[0]?.depth).toBe(2)
  })

  it('walks ancestors root-first', async () => {
    const handle = tree()
    const a = await makeDoc('A')
    const b = await makeDoc('B')
    const c = await makeDoc('C')
    await handle.placeTreeNode(a, { parentDocumentId: null })
    await handle.placeTreeNode(b, { parentDocumentId: a })
    await handle.placeTreeNode(c, { parentDocumentId: b })

    const ancestors = await handle.getAncestors(c)
    expect(ancestors.map((d) => d.fields.title)).toEqual(['A', 'B'])

    // A root has no ancestors.
    expect(await handle.getAncestors(a)).toEqual([])
  })

  it('re-parenting is reflected on the next read', async () => {
    const handle = tree()
    const x = await makeDoc('X')
    const y = await makeDoc('Y')
    const child = await makeDoc('Child')
    await handle.placeTreeNode(x, { parentDocumentId: null })
    await handle.placeTreeNode(y, { parentDocumentId: null })
    await handle.placeTreeNode(child, { parentDocumentId: x })

    expect((await handle.getAncestors(child)).map((d) => d.fields.title)).toEqual(['X'])

    await handle.placeTreeNode(child, { parentDocumentId: y })
    expect((await handle.getAncestors(child)).map((d) => d.fields.title)).toEqual(['Y'])
  })

  it('hides an unpublished node and its subtree in published mode', async () => {
    const handle = tree()
    const sec = await makeDoc('Sec')
    const pub = await makeDoc('Pub')
    const draft = await makeDoc('Draft', /* publish */ false)
    const leaf = await makeDoc('Leaf')
    await handle.placeTreeNode(sec, { parentDocumentId: null })
    await handle.placeTreeNode(pub, { parentDocumentId: sec })
    await handle.placeTreeNode(draft, { parentDocumentId: sec, beforeDocumentId: pub })
    await handle.placeTreeNode(leaf, { parentDocumentId: draft })

    // Published (client default): the draft node and its subtree drop out.
    const published = await handle.getSubtree({ rootDocumentId: sec })
    expect(published[0]?.children.map((c) => c.document.fields.title)).toEqual(['Pub'])

    // Any: the whole subtree is visible.
    const any = await handle.getSubtree({ rootDocumentId: sec, status: 'any' })
    const anyTitles = flatten(any).map((n) => n.document.fields.title)
    expect(anyTitles).toEqual(['Sec', 'Pub', 'Draft', 'Leaf'])
  })

  it('removeFromTree returns a node to the unplaced state', async () => {
    const handle = tree()
    const root = await makeDoc('RemRoot')
    const kid = await makeDoc('RemKid')
    await handle.placeTreeNode(root, { parentDocumentId: null })
    await handle.placeTreeNode(kid, { parentDocumentId: root })
    expect((await handle.getSubtree({ rootDocumentId: root }))[0]?.children).toHaveLength(1)

    await handle.removeFromTree(kid)
    expect((await handle.getSubtree({ rootDocumentId: root }))[0]?.children).toHaveLength(0)
    expect(await handle.getAncestors(kid)).toEqual([])
  })

  it('rejects tree operations on a non-tree collection', async () => {
    const plain = ctx.client.collection(plainDef.path)
    await expect(plain.placeTreeNode('whatever', { parentDocumentId: null })).rejects.toThrow(
      /not a document tree/
    )
    await expect(plain.getSubtree()).rejects.toThrow(/not a document tree/)
    await expect(plain.getAncestors('whatever')).rejects.toThrow(/not a document tree/)
  })
})

/** Flatten a TreeNode forest to a pre-order list. */
function flatten<_F>(nodes: Array<{ document: any; depth: number; children: any[] }>): any[] {
  const out: any[] = []
  for (const n of nodes) {
    out.push(n)
    out.push(...flatten(n.children))
  }
  return out
}
