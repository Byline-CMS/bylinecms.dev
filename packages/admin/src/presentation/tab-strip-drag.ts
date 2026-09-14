/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Pure state for click-and-drag scrolling of the tab strip.
 *
 * The DOM plumbing — pointer capture, the click suppression, the cursor —
 * lives in `tabs.tsx`; the rules it follows are here so they can be tested
 * without a pointer.
 */

/**
 * How far the pointer must travel before the gesture stops being a click and
 * becomes a drag.
 *
 * Without a threshold every click on a tab would nudge the strip by a pixel or
 * two, and the click suppression that follows a drag would swallow the very
 * clicks that select tabs.
 */
export const DRAG_THRESHOLD_PX = 5

/**
 * How long after a drag a click is treated as that drag's own click.
 *
 * A window rather than a consume-once flag, because the click is not
 * guaranteed to arrive: a drag released outside the strip produces none, and
 * a flag left armed would swallow the reader's next deliberate click on a tab.
 * Far longer than the browser's synthetic click takes to arrive, far shorter
 * than anyone can release and deliberately click again.
 */
export const CLICK_SUPPRESSION_MS = 100

/** Where a gesture began. An internal part of `DragState`, not a public type. */
interface DragOrigin {
  /** Pointer x at the moment the button went down. */
  pointerX: number
  /** The viewport's scroll offset at that same moment. */
  scrollLeft: number
}

export interface DragState {
  origin: DragOrigin
  /** Whether the threshold has already been crossed. */
  dragging: boolean
}

export interface DragAdvance {
  dragging: boolean
  /** The offset to scroll to, or `null` while the gesture is still a click. */
  scrollLeft: number | null
}

/**
 * Whether a `pointerdown` should begin a potential drag.
 *
 * Mouse only. Touch and pen already scroll the viewport natively, with
 * momentum and rubber-banding that a hand-rolled drag does not reproduce, so
 * taking the gesture over would trade a good interaction for a worse one.
 */
export function shouldStartDrag({
  pointerType,
  button,
  overflowing,
}: {
  pointerType: string
  button: number
  overflowing: boolean
}): boolean {
  if (pointerType !== 'mouse') return false
  // Primary button only: the middle button is paste-scroll on some platforms
  // and the secondary opens the context menu.
  if (button !== 0) return false
  return overflowing
}

/**
 * Advance a gesture given the pointer's current x.
 *
 * Returns `scrollLeft: null` while the pointer is still within the threshold,
 * so the caller leaves the viewport alone and lets the click through.
 */
export function advanceDrag(
  { origin, dragging }: DragState,
  pointerX: number,
  maxScroll: number
): DragAdvance {
  const delta = pointerX - origin.pointerX

  // Once a drag, always a drag: a gesture that wanders back inside the
  // threshold must not hand itself back to the click handler and select
  // whichever tab the pointer happens to be over.
  const isDragging = dragging || Math.abs(delta) >= DRAG_THRESHOLD_PX
  if (isDragging === false) return { dragging: false, scrollLeft: null }

  // Subtracted, not added: the content follows the pointer, so dragging right
  // reveals what is to the left and the offset falls.
  const next = origin.scrollLeft - delta

  return { dragging: true, scrollLeft: Math.min(Math.max(next, 0), maxScroll) }
}

/**
 * Whether a click arriving now belongs to a drag that has just ended, and
 * should therefore not reach the tab underneath.
 */
export function shouldSuppressClick(dragEndedAt: number | null, now: number): boolean {
  if (dragEndedAt == null) return false
  return now - dragEndedAt < CLICK_SUPPRESSION_MS
}
