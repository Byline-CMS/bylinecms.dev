/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import {
  applyProjection,
  descendantIds,
  getTreeProjection,
  type TreeProjectionRow,
} from './tree-list-projection.js'

const INDENT = 24

// Pre-order placed tree:
//   A           (root)
//     B         (child of A)
//     C         (child of A)
//       D       (child of C)
//   E           (root)
const rows: TreeProjectionRow[] = [
  { id: 'A', parentId: null, depth: 0 },
  { id: 'B', parentId: 'A', depth: 1 },
  { id: 'C', parentId: 'A', depth: 1 },
  { id: 'D', parentId: 'C', depth: 2 },
  { id: 'E', parentId: null, depth: 0 },
]

describe('descendantIds', () => {
  it('returns the contiguous deeper rows after a node', () => {
    expect([...descendantIds(rows, 'C')]).toEqual(['D'])
    expect([...descendantIds(rows, 'A')]).toEqual(['B', 'C', 'D'])
    expect([...descendantIds(rows, 'B')]).toEqual([])
  })
})

describe('getTreeProjection', () => {
  it('reorders within siblings (drop past a subtree, no horizontal offset)', () => {
    // Drag B onto D (C's last descendant), no indent change → B lands after C's
    // whole subtree, still a child of A.
    expect(getTreeProjection(rows, 'B', 'D', 0, INDENT)).toEqual({
      depth: 1,
      parentId: 'A',
      beforeId: 'C',
      afterId: null,
    })
  })

  it('re-parents a node under the row above when dragged right one level', () => {
    // Drag B onto C with a +1 level offset → B becomes C's first child, ahead
    // of C's existing child D.
    expect(getTreeProjection(rows, 'B', 'C', INDENT, INDENT)).toEqual({
      depth: 2,
      parentId: 'C',
      beforeId: null,
      afterId: 'D',
    })
  })

  it('outdents a deep node to a root when dragged far left', () => {
    // Drag D onto E, far left → D becomes a root after E.
    expect(getTreeProjection(rows, 'D', 'E', -2 * INDENT, INDENT)).toEqual({
      depth: 0,
      parentId: null,
      beforeId: 'E',
      afterId: null,
    })
  })

  it('clamps depth to one level below the row above', () => {
    // Drag E onto B with a huge right offset: dropping above B, the deepest E
    // can go is a child of A (B's parent) — it cannot leap to B's depth+1.
    expect(getTreeProjection(rows, 'E', 'B', 10 * INDENT, INDENT)).toEqual({
      depth: 1,
      parentId: 'A',
      beforeId: null,
      afterId: 'B',
    })
  })

  it('is a no-op when dropping on itself', () => {
    expect(getTreeProjection(rows, 'B', 'B', 0, INDENT)).toBeNull()
  })

  it('is a no-op when dropping into its own subtree', () => {
    // C cannot become a child of its own descendant D.
    expect(getTreeProjection(rows, 'C', 'D', INDENT, INDENT)).toBeNull()
  })
})

describe('applyProjection', () => {
  const ids = (r: TreeProjectionRow[]) => r.map((x) => `${x.id}@${x.depth}`)

  it('re-parents a node and its subtree together, shifting depth', () => {
    // Move C (with child D) under E.
    const projection = getTreeProjection(rows, 'C', 'E', INDENT, INDENT)!
    const result = applyProjection(rows, 'C', projection)
    // C now under E; D travels with C, one level deeper than C.
    expect(ids(result)).toEqual(['A@0', 'B@1', 'E@0', 'C@1', 'D@2'])
    expect(result.find((r) => r.id === 'C')?.parentId).toBe('E')
    expect(result.find((r) => r.id === 'D')?.parentId).toBe('C')
  })

  it('reorders a leaf within its sibling group', () => {
    // Move B after C's subtree (drop on D, no indent) → A: [C, B].
    const projection = getTreeProjection(rows, 'B', 'D', 0, INDENT)!
    const result = applyProjection(rows, 'B', projection)
    expect(ids(result)).toEqual(['A@0', 'C@1', 'D@2', 'B@1', 'E@0'])
    expect(result.find((r) => r.id === 'B')?.parentId).toBe('A')
  })
})
