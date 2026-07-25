/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Live-database verification of the Task 9B document-tree command surface —
 * `DocumentCommands.placeTreeNode`, `removeFromTree`, and
 * `promoteChildrenAndRemoveFromTree`. Mirrors the write-half of
 * `@byline/db-conformance`'s `document-tree` suite
 * (`packages/db-conformance/src/suites/document-tree.ts`), but that suite
 * also exercises `getTreeChildren` / `getTreeAncestors` / `getTreeSubtree`
 * (Task 10 read surface, not implemented yet) — so every assertion here reads
 * `byline_document_relationships` directly via raw SQL instead, and only
 * behaviours observable from the write commands alone are covered. Once
 * Task 10 lands, `document-tree` becomes runnable end to end and is the
 * authoritative gate; this file is the interim live-database regression
 * guard for the command half.
 */

import { type CollectionDefinition, ErrorCodes, TREE_PLACEMENT_STALE_MARKER } from '@byline/core'
import type mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'

const timestamp = Date.now()

function first<T>(rows: T[]): T {
  const row = rows[0]
  if (row == null) throw new Error('expected at least one row, got none')
  return row
}

async function queryRows(pool: mysql.Pool, sql: string, params: unknown[]): Promise<any[]> {
  const [rows] = await pool.query(sql, params)
  return rows as any[]
}

/** Read one ordered sibling group directly from `byline_document_relationships`. */
async function siblingIds(pool: mysql.Pool, parentDocumentId: string | null): Promise<string[]> {
  // MySQL's null-safe equality (`<=>`) so `parentDocumentId: null` matches
  // NULL rows (root siblings) the same way `parent_document_id IS NULL` does.
  const rows = await queryRows(
    pool,
    'SELECT child_document_id FROM byline_document_relationships WHERE parent_document_id <=> ? ORDER BY order_key',
    [parentDocumentId]
  )
  return rows.map((r) => r.child_document_id)
}

async function edgeRow(pool: mysql.Pool, documentId: string): Promise<any | undefined> {
  const rows = await queryRows(
    pool,
    'SELECT child_document_id, parent_document_id, order_key FROM byline_document_relationships WHERE child_document_id = ?',
    [documentId]
  )
  return rows[0]
}

const TreeCollectionConfig: CollectionDefinition = {
  path: `tree-test-${timestamp}`,
  labels: { singular: 'TreeTest', plural: 'TreeTests' },
  fields: [{ name: 'title', type: 'text' }],
}

const OtherCollectionConfig: CollectionDefinition = {
  path: `tree-other-test-${timestamp}`,
  labels: { singular: 'TreeOther', plural: 'TreeOthers' },
  fields: [{ name: 'title', type: 'text' }],
}

describe('DocumentCommands tree mutations (mysql, live database)', () => {
  let testDb: ReturnType<typeof setupTestDB>
  let rawPool: mysql.Pool
  let treeCollectionId: string
  let otherCollectionId: string

  async function createDoc(
    collectionId: string,
    config: CollectionDefinition,
    title: string
  ): Promise<string> {
    const created = await testDb.commandBuilders.documents.createDocumentVersion({
      collectionId,
      collectionVersion: 1,
      collectionConfig: config,
      action: 'create',
      documentData: { title },
      locale: 'all',
      status: 'published',
    })
    return created.document.document_id
  }

  beforeAll(async () => {
    testDb = setupTestDB([TreeCollectionConfig, OtherCollectionConfig])
    rawPool = testDb.pool
    treeCollectionId = first(
      await testDb.commandBuilders.collections.create(
        TreeCollectionConfig.path,
        TreeCollectionConfig
      )
    ).id
    otherCollectionId = first(
      await testDb.commandBuilders.collections.create(
        OtherCollectionConfig.path,
        OtherCollectionConfig
      )
    ).id
  })

  afterAll(async () => {
    await testDb.commandBuilders.collections.delete(treeCollectionId)
    await testDb.commandBuilders.collections.delete(otherCollectionId)
    await teardownTestDB()
  })

  it('places roots and children, ordered per-parent', async () => {
    const a = await createDoc(treeCollectionId, TreeCollectionConfig, 'Root A')
    const b = await createDoc(treeCollectionId, TreeCollectionConfig, 'Root B')
    const c = await createDoc(treeCollectionId, TreeCollectionConfig, 'Child C')
    const d = await createDoc(treeCollectionId, TreeCollectionConfig, 'Child D')

    await testDb.commandBuilders.documents.placeTreeNode({
      collectionId: treeCollectionId,
      documentId: a,
      parentDocumentId: null,
    })
    await testDb.commandBuilders.documents.placeTreeNode({
      collectionId: treeCollectionId,
      documentId: b,
      parentDocumentId: null,
      beforeDocumentId: a,
    })
    expect(await siblingIds(rawPool, null)).toEqual(expect.arrayContaining([a, b]))
    const roots = await siblingIds(rawPool, null)
    expect(roots.indexOf(a)).toBeLessThan(roots.indexOf(b))

    await testDb.commandBuilders.documents.placeTreeNode({
      collectionId: treeCollectionId,
      documentId: c,
      parentDocumentId: a,
    })
    await testDb.commandBuilders.documents.placeTreeNode({
      collectionId: treeCollectionId,
      documentId: d,
      parentDocumentId: a,
      beforeDocumentId: c,
    })
    expect(await siblingIds(rawPool, a)).toEqual([c, d])
  })

  it('reorders siblings in place — upsert keeps one row per document', async () => {
    const a = await createDoc(treeCollectionId, TreeCollectionConfig, 'P A')
    const x = await createDoc(treeCollectionId, TreeCollectionConfig, 'X')
    const y = await createDoc(treeCollectionId, TreeCollectionConfig, 'Y')
    await testDb.commandBuilders.documents.placeTreeNode({
      collectionId: treeCollectionId,
      documentId: a,
      parentDocumentId: null,
    })
    await testDb.commandBuilders.documents.placeTreeNode({
      collectionId: treeCollectionId,
      documentId: x,
      parentDocumentId: a,
    })
    await testDb.commandBuilders.documents.placeTreeNode({
      collectionId: treeCollectionId,
      documentId: y,
      parentDocumentId: a,
      beforeDocumentId: x,
    })
    expect(await siblingIds(rawPool, a)).toEqual([x, y])

    await testDb.commandBuilders.documents.placeTreeNode({
      collectionId: treeCollectionId,
      documentId: y,
      parentDocumentId: a,
      afterDocumentId: x,
    })
    const kids = await siblingIds(rawPool, a)
    expect(kids).toEqual([y, x])
    expect(kids.length).toBe(2) // no duplicate row from the upsert
  })

  it('rejects a stale target neighbour group as a conflict', async () => {
    const parentA = await createDoc(treeCollectionId, TreeCollectionConfig, 'Conflict Parent A')
    const parentB = await createDoc(treeCollectionId, TreeCollectionConfig, 'Conflict Parent B')
    const neighbour = await createDoc(treeCollectionId, TreeCollectionConfig, 'Conflict Neighbour')
    const node = await createDoc(treeCollectionId, TreeCollectionConfig, 'Conflict Node')

    await testDb.commandBuilders.documents.placeTreeNode({
      collectionId: treeCollectionId,
      documentId: neighbour,
      parentDocumentId: parentA,
    })
    await testDb.commandBuilders.documents.placeTreeNode({
      collectionId: treeCollectionId,
      documentId: neighbour,
      parentDocumentId: parentB,
    })

    await expect(
      testDb.commandBuilders.documents.placeTreeNode({
        collectionId: treeCollectionId,
        documentId: node,
        parentDocumentId: parentA,
        beforeDocumentId: neighbour,
      })
    ).rejects.toMatchObject({
      code: ErrorCodes.CONFLICT,
      message: expect.stringContaining(TREE_PLACEMENT_STALE_MARKER),
    })
  })

  it('allows only one concurrent placement into the same asserted sibling gap', async () => {
    const parent = await createDoc(treeCollectionId, TreeCollectionConfig, 'Gap Parent')
    const left = await createDoc(treeCollectionId, TreeCollectionConfig, 'Gap Left')
    const right = await createDoc(treeCollectionId, TreeCollectionConfig, 'Gap Right')
    const nodeFirst = await createDoc(treeCollectionId, TreeCollectionConfig, 'Gap First')
    const nodeSecond = await createDoc(treeCollectionId, TreeCollectionConfig, 'Gap Second')

    await testDb.commandBuilders.documents.placeTreeNode({
      collectionId: treeCollectionId,
      documentId: left,
      parentDocumentId: parent,
    })
    await testDb.commandBuilders.documents.placeTreeNode({
      collectionId: treeCollectionId,
      documentId: right,
      parentDocumentId: parent,
      beforeDocumentId: left,
    })

    const placeInSameGap = (documentId: string) =>
      testDb.commandBuilders.documents.placeTreeNode({
        collectionId: treeCollectionId,
        documentId,
        parentDocumentId: parent,
        beforeDocumentId: left,
        afterDocumentId: right,
      })
    const results = await Promise.allSettled([
      placeInSameGap(nodeFirst),
      placeInSameGap(nodeSecond),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({ reason: { code: ErrorCodes.CONFLICT } })

    const winner = results[0]?.status === 'fulfilled' ? nodeFirst : nodeSecond
    const loser = winner === nodeFirst ? nodeSecond : nodeFirst
    expect(await siblingIds(rawPool, parent)).toEqual([left, winner, right])
    expect(await edgeRow(rawPool, loser)).toBeUndefined() // never placed
  })

  it('rejects placement when the moving node was deleted after the placement snapshot', async () => {
    const node = await createDoc(treeCollectionId, TreeCollectionConfig, 'Deleted Moving Node')
    await testDb.commandBuilders.documents.placeTreeNode({
      collectionId: treeCollectionId,
      documentId: node,
      parentDocumentId: null,
    })
    await testDb.commandBuilders.documents.softDeleteDocument({ document_id: node })

    await expect(
      testDb.commandBuilders.documents.placeTreeNode({
        collectionId: treeCollectionId,
        documentId: node,
        parentDocumentId: null,
      })
    ).rejects.toMatchObject({ code: ErrorCodes.CONFLICT })
  })

  it('rejects a cross-collection neighbour as structural validation', async () => {
    const parent = await createDoc(
      treeCollectionId,
      TreeCollectionConfig,
      'Foreign Neighbour Parent'
    )
    const node = await createDoc(treeCollectionId, TreeCollectionConfig, 'Foreign Neighbour Node')
    const foreign = await createDoc(otherCollectionId, OtherCollectionConfig, 'Foreign Neighbour')

    await expect(
      testDb.commandBuilders.documents.placeTreeNode({
        collectionId: treeCollectionId,
        documentId: node,
        parentDocumentId: parent,
        afterDocumentId: foreign,
      })
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION })
  })

  it('rejects a self-parent and a cycle', async () => {
    const a = await createDoc(treeCollectionId, TreeCollectionConfig, 'CA')
    const c = await createDoc(treeCollectionId, TreeCollectionConfig, 'CC')
    await testDb.commandBuilders.documents.placeTreeNode({
      collectionId: treeCollectionId,
      documentId: a,
      parentDocumentId: null,
    })
    await testDb.commandBuilders.documents.placeTreeNode({
      collectionId: treeCollectionId,
      documentId: c,
      parentDocumentId: a,
    })

    await expect(
      testDb.commandBuilders.documents.placeTreeNode({
        collectionId: treeCollectionId,
        documentId: a,
        parentDocumentId: a,
      })
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION })

    // A is C's ancestor, so making A a child of C is a cycle — exercises the
    // `WITH RECURSIVE chain AS (...)` cycle guard.
    await expect(
      testDb.commandBuilders.documents.placeTreeNode({
        collectionId: treeCollectionId,
        documentId: a,
        parentDocumentId: c,
      })
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION })
  })

  it('re-parents atomically — one edge row, updated in place', async () => {
    const a = await createDoc(treeCollectionId, TreeCollectionConfig, 'RA')
    const b = await createDoc(treeCollectionId, TreeCollectionConfig, 'RB')
    const c = await createDoc(treeCollectionId, TreeCollectionConfig, 'RC')
    await testDb.commandBuilders.documents.placeTreeNode({
      collectionId: treeCollectionId,
      documentId: a,
      parentDocumentId: null,
    })
    await testDb.commandBuilders.documents.placeTreeNode({
      collectionId: treeCollectionId,
      documentId: b,
      parentDocumentId: null,
    })
    await testDb.commandBuilders.documents.placeTreeNode({
      collectionId: treeCollectionId,
      documentId: c,
      parentDocumentId: a,
    })
    expect(await siblingIds(rawPool, a)).toEqual([c])

    await testDb.commandBuilders.documents.placeTreeNode({
      collectionId: treeCollectionId,
      documentId: c,
      parentDocumentId: b,
    })

    expect(await siblingIds(rawPool, a)).toEqual([])
    expect(await siblingIds(rawPool, b)).toEqual([c])
    const edge = await edgeRow(rawPool, c)
    expect(edge.parent_document_id).toBe(b)
  })

  it('removeFromTree returns a node to the unplaced state and is idempotent', async () => {
    const a = await createDoc(treeCollectionId, TreeCollectionConfig, 'UA')
    const c = await createDoc(treeCollectionId, TreeCollectionConfig, 'UC')
    await testDb.commandBuilders.documents.placeTreeNode({
      collectionId: treeCollectionId,
      documentId: a,
      parentDocumentId: null,
    })
    await testDb.commandBuilders.documents.placeTreeNode({
      collectionId: treeCollectionId,
      documentId: c,
      parentDocumentId: a,
    })
    expect(await siblingIds(rawPool, a)).toEqual([c])

    const removed = await testDb.commandBuilders.documents.removeFromTree({
      collectionId: treeCollectionId,
      documentId: c,
    })
    expect(removed.changed).toBe(true)
    expect(await siblingIds(rawPool, a)).toEqual([])
    expect(await edgeRow(rawPool, c)).toBeUndefined()

    // Idempotent — removing an already-unplaced node is a no-op.
    await expect(
      testDb.commandBuilders.documents.removeFromTree({
        collectionId: treeCollectionId,
        documentId: c,
      })
    ).resolves.toMatchObject({ changed: false })
  })

  it('promoteChildrenAndRemoveFromTree promotes children to root and removes the parent edge', async () => {
    const parent = await createDoc(treeCollectionId, TreeCollectionConfig, 'Promote Parent')
    const grandparent = await createDoc(
      treeCollectionId,
      TreeCollectionConfig,
      'Promote Grandparent'
    )
    const childOne = await createDoc(treeCollectionId, TreeCollectionConfig, 'Promote Child 1')
    const childTwo = await createDoc(treeCollectionId, TreeCollectionConfig, 'Promote Child 2')

    await testDb.commandBuilders.documents.placeTreeNode({
      collectionId: treeCollectionId,
      documentId: grandparent,
      parentDocumentId: null,
    })
    await testDb.commandBuilders.documents.placeTreeNode({
      collectionId: treeCollectionId,
      documentId: parent,
      parentDocumentId: grandparent,
    })
    await testDb.commandBuilders.documents.placeTreeNode({
      collectionId: treeCollectionId,
      documentId: childOne,
      parentDocumentId: parent,
    })
    await testDb.commandBuilders.documents.placeTreeNode({
      collectionId: treeCollectionId,
      documentId: childTwo,
      parentDocumentId: parent,
      beforeDocumentId: childOne,
    })
    expect(await siblingIds(rawPool, parent)).toEqual([childOne, childTwo])

    const result = await testDb.commandBuilders.documents.promoteChildrenAndRemoveFromTree({
      collectionId: treeCollectionId,
      documentId: parent,
    })
    expect(result.removed.changed).toBe(true)
    expect(result.promoted.map((p) => p.documentId).sort()).toEqual([childOne, childTwo].sort())

    // Parent edge gone; both children now root-level (parent_document_id NULL).
    expect(await edgeRow(rawPool, parent)).toBeUndefined()
    const oneEdge = await edgeRow(rawPool, childOne)
    const twoEdge = await edgeRow(rawPool, childTwo)
    expect(oneEdge.parent_document_id).toBeNull()
    expect(twoEdge.parent_document_id).toBeNull()

    // No longer children of the (now-removed) parent edge.
    expect(await siblingIds(rawPool, parent)).toEqual([])
  })
})
