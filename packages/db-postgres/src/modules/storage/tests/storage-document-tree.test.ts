/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Integration tests for the document-tree commands — `placeTreeNode` /
 * `removeFromTree` (writes) and `getTreeAncestors` / `getTreeChildren` (reads).
 * These back the `tree: true` document-tree primitive: a document-grain,
 * unversioned single-parent ordered hierarchy stored in
 * `byline_document_relationships`. See docs/DOCUMENT-TREE.md.
 *
 * Invariants asserted here:
 *   - place / reorder / re-parent are upserts that keep one row per document
 *     (the single-parent invariant) and order siblings per-parent,
 *   - the cycle guard rejects a move that would make a node its own ancestor,
 *   - the same-collection guard rejects cross-collection edges,
 *   - ancestors walk root-first; children read in order,
 *   - removeFromTree returns a node to the unplaced state.
 */

import type { CollectionDefinition } from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'

let commandBuilders: ReturnType<typeof import('../storage-commands.js').createCommandBuilders>
let queryBuilders: ReturnType<typeof import('../storage-queries.js').createQueryBuilders>

const timestamp = Date.now()

const TreeCollectionConfig: CollectionDefinition = {
  path: `tree-${timestamp}`,
  labels: { singular: 'TreeTest', plural: 'TreeTests' },
  useAsPath: 'title',
  fields: [{ name: 'title', type: 'text' }],
}

const OtherCollectionConfig: CollectionDefinition = {
  path: `tree-other-${timestamp}`,
  labels: { singular: 'TreeOther', plural: 'TreeOthers' },
  useAsPath: 'title',
  fields: [{ name: 'title', type: 'text' }],
}

let treeCollection: { id: string } = {} as any
let otherCollection: { id: string } = {} as any

async function createDoc(collectionId: string, config: CollectionDefinition, title: string) {
  const created = await commandBuilders.documents.createDocumentVersion({
    collectionId,
    collectionVersion: 1,
    collectionConfig: config,
    action: 'create',
    documentData: { title },
    path: `${title.toLowerCase().replace(/\s+/g, '-')}-${timestamp}`,
    locale: 'all',
    status: 'published',
  })
  return created.document.document_id as string
}

function childIds(rows: Array<{ document_id: string; order_key: string }>) {
  return rows.map((r) => r.document_id)
}

describe('document-tree commands', () => {
  beforeAll(async () => {
    const testDB = setupTestDB([TreeCollectionConfig, OtherCollectionConfig])
    commandBuilders = testDB.commandBuilders
    queryBuilders = testDB.queryBuilders

    const tree = await commandBuilders.collections.create(
      TreeCollectionConfig.path,
      TreeCollectionConfig
    )
    const other = await commandBuilders.collections.create(
      OtherCollectionConfig.path,
      OtherCollectionConfig
    )
    if (tree[0] == null || other[0] == null) throw new Error('Failed to create test collections')
    treeCollection = { id: tree[0].id }
    otherCollection = { id: other[0].id }
  })

  afterAll(async () => {
    try {
      await commandBuilders.collections.delete(treeCollection.id)
      await commandBuilders.collections.delete(otherCollection.id)
    } catch (error) {
      console.error('Failed to cleanup test collections:', error)
    }
    await teardownTestDB()
  })

  it('places roots and children, ordered per-parent', async () => {
    const a = await createDoc(treeCollection.id, TreeCollectionConfig, 'Root A')
    const b = await createDoc(treeCollection.id, TreeCollectionConfig, 'Root B')
    const c = await createDoc(treeCollection.id, TreeCollectionConfig, 'Child C')
    const d = await createDoc(treeCollection.id, TreeCollectionConfig, 'Child D')

    // Two roots, A then B.
    await commandBuilders.documents.placeTreeNode({
      collectionId: treeCollection.id,
      documentId: a,
      parentDocumentId: null,
    })
    await commandBuilders.documents.placeTreeNode({
      collectionId: treeCollection.id,
      documentId: b,
      parentDocumentId: null,
      beforeDocumentId: a,
    })

    const roots = await queryBuilders.documents.getTreeChildren({
      collectionId: treeCollection.id,
      parentDocumentId: null,
    })
    expect(childIds(roots)).toEqual([a, b])

    // Two children of A, C then D.
    await commandBuilders.documents.placeTreeNode({
      collectionId: treeCollection.id,
      documentId: c,
      parentDocumentId: a,
    })
    await commandBuilders.documents.placeTreeNode({
      collectionId: treeCollection.id,
      documentId: d,
      parentDocumentId: a,
      beforeDocumentId: c,
    })

    const aChildren = await queryBuilders.documents.getTreeChildren({
      collectionId: treeCollection.id,
      parentDocumentId: a,
    })
    expect(childIds(aChildren)).toEqual([c, d])
  })

  it('reorders siblings without changing parent or count', async () => {
    const a = await createDoc(treeCollection.id, TreeCollectionConfig, 'P A')
    const x = await createDoc(treeCollection.id, TreeCollectionConfig, 'X')
    const y = await createDoc(treeCollection.id, TreeCollectionConfig, 'Y')
    await commandBuilders.documents.placeTreeNode({
      collectionId: treeCollection.id,
      documentId: a,
      parentDocumentId: null,
    })
    await commandBuilders.documents.placeTreeNode({
      collectionId: treeCollection.id,
      documentId: x,
      parentDocumentId: a,
    })
    await commandBuilders.documents.placeTreeNode({
      collectionId: treeCollection.id,
      documentId: y,
      parentDocumentId: a,
      beforeDocumentId: x,
    })
    let kids = await queryBuilders.documents.getTreeChildren({
      collectionId: treeCollection.id,
      parentDocumentId: a,
    })
    expect(childIds(kids)).toEqual([x, y])

    // Move Y before X.
    await commandBuilders.documents.placeTreeNode({
      collectionId: treeCollection.id,
      documentId: y,
      parentDocumentId: a,
      afterDocumentId: x,
    })
    kids = await queryBuilders.documents.getTreeChildren({
      collectionId: treeCollection.id,
      parentDocumentId: a,
    })
    expect(childIds(kids)).toEqual([y, x])
    expect(kids.length, 'no duplicate row from upsert').toBe(2)
  })

  it('re-parents atomically and updates ancestors', async () => {
    const a = await createDoc(treeCollection.id, TreeCollectionConfig, 'RA')
    const b = await createDoc(treeCollection.id, TreeCollectionConfig, 'RB')
    const c = await createDoc(treeCollection.id, TreeCollectionConfig, 'RC')
    await commandBuilders.documents.placeTreeNode({
      collectionId: treeCollection.id,
      documentId: a,
      parentDocumentId: null,
    })
    await commandBuilders.documents.placeTreeNode({
      collectionId: treeCollection.id,
      documentId: b,
      parentDocumentId: null,
    })
    await commandBuilders.documents.placeTreeNode({
      collectionId: treeCollection.id,
      documentId: c,
      parentDocumentId: a,
    })

    expect(
      (await queryBuilders.documents.getTreeAncestors({ document_id: c })).map((r) => r.document_id)
    ).toEqual([a])

    // Move C under B.
    await commandBuilders.documents.placeTreeNode({
      collectionId: treeCollection.id,
      documentId: c,
      parentDocumentId: b,
    })

    const aKids = await queryBuilders.documents.getTreeChildren({
      collectionId: treeCollection.id,
      parentDocumentId: a,
    })
    const bKids = await queryBuilders.documents.getTreeChildren({
      collectionId: treeCollection.id,
      parentDocumentId: b,
    })
    expect(childIds(aKids)).not.toContain(c)
    expect(childIds(bKids)).toEqual([c])
    expect(
      (await queryBuilders.documents.getTreeAncestors({ document_id: c })).map((r) => r.document_id)
    ).toEqual([b])
  })

  it('walks ancestors root-first with increasing depth', async () => {
    const a = await createDoc(treeCollection.id, TreeCollectionConfig, 'GA')
    const b = await createDoc(treeCollection.id, TreeCollectionConfig, 'GB')
    const c = await createDoc(treeCollection.id, TreeCollectionConfig, 'GC')
    await commandBuilders.documents.placeTreeNode({
      collectionId: treeCollection.id,
      documentId: a,
      parentDocumentId: null,
    })
    await commandBuilders.documents.placeTreeNode({
      collectionId: treeCollection.id,
      documentId: b,
      parentDocumentId: a,
    })
    await commandBuilders.documents.placeTreeNode({
      collectionId: treeCollection.id,
      documentId: c,
      parentDocumentId: b,
    })

    const ancestors = await queryBuilders.documents.getTreeAncestors({ document_id: c })
    expect(ancestors.map((r) => r.document_id)).toEqual([a, b]) // root-first
    expect(ancestors.map((r) => r.depth)).toEqual([2, 1]) // a is 2 hops up, b is 1

    // Root + unplaced nodes have no ancestors.
    expect(await queryBuilders.documents.getTreeAncestors({ document_id: a })).toEqual([])
  })

  it('rejects a self-parent and a cycle', async () => {
    const a = await createDoc(treeCollection.id, TreeCollectionConfig, 'CA')
    const c = await createDoc(treeCollection.id, TreeCollectionConfig, 'CC')
    await commandBuilders.documents.placeTreeNode({
      collectionId: treeCollection.id,
      documentId: a,
      parentDocumentId: null,
    })
    await commandBuilders.documents.placeTreeNode({
      collectionId: treeCollection.id,
      documentId: c,
      parentDocumentId: a,
    })

    // Self-parent.
    await expect(
      commandBuilders.documents.placeTreeNode({
        collectionId: treeCollection.id,
        documentId: a,
        parentDocumentId: a,
      })
    ).rejects.toThrow()

    // Cycle: A is C's ancestor, so making A a child of C is a cycle.
    await expect(
      commandBuilders.documents.placeTreeNode({
        collectionId: treeCollection.id,
        documentId: a,
        parentDocumentId: c,
      })
    ).rejects.toThrow()
  })

  it('rejects a cross-collection edge', async () => {
    const a = await createDoc(treeCollection.id, TreeCollectionConfig, 'XA')
    const foreign = await createDoc(otherCollection.id, OtherCollectionConfig, 'Foreign')
    await commandBuilders.documents.placeTreeNode({
      collectionId: treeCollection.id,
      documentId: a,
      parentDocumentId: null,
    })

    await expect(
      commandBuilders.documents.placeTreeNode({
        collectionId: treeCollection.id,
        documentId: a,
        parentDocumentId: foreign,
      })
    ).rejects.toThrow()
  })

  it('removeFromTree returns a node to the unplaced state', async () => {
    const a = await createDoc(treeCollection.id, TreeCollectionConfig, 'UA')
    const c = await createDoc(treeCollection.id, TreeCollectionConfig, 'UC')
    await commandBuilders.documents.placeTreeNode({
      collectionId: treeCollection.id,
      documentId: a,
      parentDocumentId: null,
    })
    await commandBuilders.documents.placeTreeNode({
      collectionId: treeCollection.id,
      documentId: c,
      parentDocumentId: a,
    })
    expect(
      childIds(
        await queryBuilders.documents.getTreeChildren({
          collectionId: treeCollection.id,
          parentDocumentId: a,
        })
      )
    ).toEqual([c])

    await commandBuilders.documents.removeFromTree({ documentId: c })

    expect(
      await queryBuilders.documents.getTreeChildren({
        collectionId: treeCollection.id,
        parentDocumentId: a,
      })
    ).toEqual([])
    expect(await queryBuilders.documents.getTreeAncestors({ document_id: c })).toEqual([])

    // Idempotent — removing an already-unplaced node is a no-op.
    await expect(
      commandBuilders.documents.removeFromTree({ documentId: c })
    ).resolves.toBeUndefined()
  })
})
