/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { TargetRole, ViewAnchor } from './editor-view-state'

export interface AnchorCandidate {
  path: string
  role: TargetRole
  /** Viewport-relative top and bottom edges. */
  top: number
  bottom: number
  /** How many markers enclose this one; deeper is more specific. */
  depth: number
}

/**
 * Chooses the marker that keeps the scroll position across a navigation.
 *
 *   1. The topmost marker whose top edge is inside the viewport; between
 *      markers sharing that edge, the most specific one.
 *   2. Otherwise a marker that spans the viewport's top edge (a long field
 *      that fills the screen), with its negative offset: the most specific
 *      one, then the shortest, so a giant enclosing group loses to the field
 *      inside it.
 */
export function pickViewAnchor(
  candidates: readonly AnchorCandidate[],
  viewportHeight: number
): ViewAnchor | null {
  let edge: AnchorCandidate | null = null
  let spanning: AnchorCandidate | null = null
  for (const candidate of candidates) {
    if (candidate.bottom <= 0 || candidate.top >= viewportHeight) continue
    if (candidate.top >= 0) {
      if (
        edge == null ||
        candidate.top < edge.top ||
        (candidate.top === edge.top && candidate.depth > edge.depth)
      ) {
        edge = candidate
      }
    } else if (
      spanning == null ||
      candidate.depth > spanning.depth ||
      (candidate.depth === spanning.depth &&
        candidate.bottom - candidate.top < spanning.bottom - spanning.top)
    ) {
      spanning = candidate
    }
  }
  const chosen = edge ?? spanning
  return chosen ? { path: chosen.path, role: chosen.role, offset: chosen.top } : null
}
