/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Pure projection helpers for the drag-to-reorder / re-parent tree list
 * (docs/04-collections/04-document-trees.md, phase 2). Adapted from the dnd-kit "sortable tree"
 * pattern: a pre-order flattened list where the drag's **horizontal** offset
 * projects a target depth, clamped to what the neighbouring rows allow, and the
 * target parent + sibling neighbours are resolved from that depth.
 *
 * Kept free of React / dnd-kit so the projection is unit-testable in isolation;
 * the component feeds it the live drag offset and applies the result through the
 * `placeTreeNode` tree command.
 */

/** Minimal row shape the projection needs (a slice of `CollectionTreeRow`). */
export interface TreeProjectionRow {
  id: string
  parentId: string | null
  depth: number
}

export interface TreeProjection {
  /** Projected depth of the dragged node at the drop position. */
  depth: number
  /** Resolved parent at that depth (`null` = root). */
  parentId: string | null
  /** Sibling immediately *above* the drop within the target parent (or null). */
  beforeId: string | null
  /** Sibling immediately *below* the drop within the target parent (or null). */
  afterId: string | null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function arrayMove<T>(items: T[], from: number, to: number): T[] {
  const next = items.slice()
  const [moved] = next.splice(from, 1)
  if (moved !== undefined) next.splice(to, 0, moved)
  return next
}

/**
 * The ids of `activeId`'s descendants. In a pre-order list a node's descendants
 * are the contiguous following rows with a strictly greater depth — they travel
 * with the node (the adjacency edge to their parent is unchanged), so they are
 * removed from the working list before projecting.
 */
export function descendantIds(rows: TreeProjectionRow[], activeId: string): Set<string> {
  const ids = new Set<string>()
  const start = rows.findIndex((r) => r.id === activeId)
  if (start === -1) return ids
  const baseDepth = rows[start]?.depth
  for (let i = start + 1; i < rows.length && rows[i]?.depth > baseDepth; i++) {
    ids.add(rows[i]?.id)
  }
  return ids
}

/**
 * Project where the dragged node would land. `rows` is the full pre-order placed
 * tree; `dragOffsetX` is the pointer's horizontal delta in px; `indentWidth` is
 * the px-per-depth indentation step. Returns `null` for a no-op drag (dropping
 * on itself or into its own subtree).
 */
export function getTreeProjection(
  rows: TreeProjectionRow[],
  activeId: string,
  overId: string,
  dragOffsetX: number,
  indentWidth: number
): TreeProjection | null {
  if (activeId === overId) return null

  // Drop into own subtree is invalid — the descendants travel with the node.
  const descendants = descendantIds(rows, activeId)
  if (descendants.has(overId)) return null

  // Collapse the dragged subtree to a single unit for projection.
  const working = rows.filter((r) => r.id === activeId || !descendants.has(r.id))

  const activeIndex = working.findIndex((r) => r.id === activeId)
  const overIndex = working.findIndex((r) => r.id === overId)
  if (activeIndex === -1 || overIndex === -1) return null

  const moved = arrayMove(working, activeIndex, overIndex)
  const previous = moved[overIndex - 1]
  const next = moved[overIndex + 1]

  const dragDepth = Math.round(dragOffsetX / indentWidth)
  const projectedDepth = working[activeIndex]?.depth + dragDepth
  const maxDepth = previous ? previous.depth + 1 : 0
  const minDepth = next ? next.depth : 0
  const depth = clamp(projectedDepth, minDepth, maxDepth)

  const parentId = resolveParentId(moved, overIndex, depth, previous)

  // Sibling neighbours within the target parent, scanning out from the drop.
  let beforeId: string | null = null
  for (let i = overIndex - 1; i >= 0; i--) {
    const row = moved[i]!
    if (row.depth < depth) break
    if (row.depth === depth && row.parentId === parentId) {
      beforeId = row.id
      break
    }
  }
  let afterId: string | null = null
  for (let i = overIndex + 1; i < moved.length; i++) {
    const row = moved[i]!
    if (row.depth < depth) break
    if (row.depth === depth && row.parentId === parentId) {
      afterId = row.id
      break
    }
  }

  return { depth, parentId, beforeId, afterId }
}

/**
 * Apply a projection to the flat row list — produce the new pre-order ordering
 * for an **optimistic** repaint (the server returns the canonical order on the
 * next read). The dragged node's whole subtree (contiguous deeper rows) travels
 * with it; depths are shifted by the projected delta and the node's `parentId`
 * is updated. Generic so it preserves the caller's full row shape.
 */
export function applyProjection<T extends TreeProjectionRow>(
  rows: T[],
  activeId: string,
  p: TreeProjection
): T[] {
  const start = rows.findIndex((r) => r.id === activeId)
  if (start === -1) return rows
  const baseDepth = rows[start]?.depth

  let end = start + 1
  while (end < rows.length && rows[end]?.depth > baseDepth) end++

  const delta = p.depth - baseDepth
  const block = rows
    .slice(start, end)
    .map((row, i) =>
      i === 0
        ? { ...row, depth: row.depth + delta, parentId: p.parentId }
        : { ...row, depth: row.depth + delta }
    )

  const without = [...rows.slice(0, start), ...rows.slice(end)]

  let insertAt: number
  if (p.beforeId != null) {
    const bi = without.findIndex((r) => r.id === p.beforeId)
    if (bi === -1) {
      insertAt = without.length
    } else {
      // after beforeId and its whole subtree
      let j = bi + 1
      const bd = without[bi]?.depth
      while (j < without.length && without[j]?.depth > bd) j++
      insertAt = j
    }
  } else if (p.afterId != null) {
    const ai = without.findIndex((r) => r.id === p.afterId)
    insertAt = ai === -1 ? without.length : ai
  } else if (p.parentId != null) {
    const pi = without.findIndex((r) => r.id === p.parentId)
    insertAt = pi === -1 ? without.length : pi + 1
  } else {
    insertAt = without.length
  }

  return [...without.slice(0, insertAt), ...block, ...without.slice(insertAt)]
}

function resolveParentId(
  moved: TreeProjectionRow[],
  overIndex: number,
  depth: number,
  previous: TreeProjectionRow | undefined
): string | null {
  if (depth === 0 || previous == null) return null
  if (depth === previous.depth) return previous.parentId
  if (depth > previous.depth) return previous.id
  // depth < previous.depth — find the nearest preceding row at the target depth
  // and inherit its parent.
  for (let i = overIndex - 1; i >= 0; i--) {
    if (moved[i]?.depth === depth) return moved[i]?.parentId
  }
  return null
}
