/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Pure geometry for the admin tab strip's overflow behaviour.
 *
 * The DOM reads and the React state live in `tabs.tsx`; every decision they
 * drive is made here, so the rules are testable without a layout engine.
 */

/**
 * Layout widths tolerate sub-pixel error at fractional device pixel ratios. A
 * scroll position within this many pixels of an edge counts as having reached
 * it — without the tolerance a trailing fade would never clear.
 */
const EDGE_EPSILON = 1

/** Breathing room left beside a tab when scrolling it into view. */
const DEFAULT_REVEAL_PADDING = 8

export interface StripMeasurements {
  /**
   * Intrinsic content width of the tablist row.
   *
   * The row is laid out at `max-content`, so this is the width the tabs want
   * regardless of how much room the viewport currently gives them. A row that
   * shrank to its container would report the container's width back and the
   * strip could never detect overflow at all.
   */
  rowWidth: number
  /**
   * Usable width of the strip container.
   *
   * Independent of whether the trigger is rendered — the container is sized by
   * the layout above it, not by its own children.
   */
  containerWidth: number
  /** Width the overflow trigger occupies when it is rendered. */
  triggerWidth: number
  /** Gap between the viewport and the trigger. */
  triggerGap: number
  /** Current horizontal scroll offset of the viewport. */
  scrollLeft: number
}

export interface StripState {
  /** Whether the row needs the scrolling viewport and the overflow trigger. */
  overflowing: boolean
  /** Width available to the scrolling viewport. */
  viewportWidth: number
  /** Whether the viewport is scrolled fully left (hides the leading fade). */
  atStart: boolean
  /** Whether the viewport is scrolled fully right (hides the trailing fade). */
  atEnd: boolean
}

export interface RevealMeasurements {
  viewportWidth: number
  scrollLeft: number
  /** The tab's offset from the start of the row. */
  tabOffsetLeft: number
  tabWidth: number
  rowWidth: number
  padding?: number
}

/**
 * Resolve whether the strip overflows, and where it sits within its scroll
 * range.
 *
 * Overflow is decided against the bare container, and deliberately takes no
 * account of the trigger: a row that fits the container fits, and reserving
 * the trigger's width first would summon a menu for tabs that were never cut
 * off. The trigger is subtracted only afterwards, to size the viewport it now
 * shares the container with.
 *
 * That ordering is also what keeps the result stable. The trigger's presence
 * changes the viewport but never `containerWidth` — which the layout above
 * sets — and never `rowWidth`, which the row holds at `max-content`. So the
 * overflow answer cannot feed back into its own inputs.
 */
export function computeStripState({
  rowWidth,
  containerWidth,
  triggerWidth,
  triggerGap,
  scrollLeft,
}: StripMeasurements): StripState {
  // A container with no measured width has not been laid out yet. Reporting
  // overflow here would flash a trigger onto the first paint.
  const measured = containerWidth > 0
  const overflowing = measured && rowWidth > containerWidth

  if (overflowing === false) {
    return {
      overflowing: false,
      viewportWidth: Math.max(0, containerWidth),
      atStart: true,
      atEnd: true,
    }
  }

  const viewportWidth = Math.max(0, containerWidth - triggerWidth - triggerGap)
  const maxScroll = Math.max(0, rowWidth - viewportWidth)

  return {
    overflowing: true,
    viewportWidth,
    atStart: scrollLeft <= EDGE_EPSILON,
    atEnd: scrollLeft >= maxScroll - EDGE_EPSILON,
  }
}

/**
 * The scroll offset that brings one tab into view, or `null` when the tab is
 * already visible and the viewport should be left untouched.
 *
 * Returning `null` rather than the current offset is the point: this runs on
 * selection and on focus, and writing `scrollLeft` unconditionally would
 * cancel a scroll the reader is in the middle of.
 */
export function computeRevealScroll({
  viewportWidth,
  scrollLeft,
  tabOffsetLeft,
  tabWidth,
  rowWidth,
  padding = DEFAULT_REVEAL_PADDING,
}: RevealMeasurements): number | null {
  const maxScroll = Math.max(0, rowWidth - viewportWidth)
  const clamp = (value: number) => Math.min(Math.max(value, 0), maxScroll)

  const leadingEdge = tabOffsetLeft - padding
  const trailingEdge = tabOffsetLeft + tabWidth + padding

  let next: number

  if (tabWidth + padding * 2 >= viewportWidth) {
    // The tab is wider than the viewport, so it cannot be framed. Align its
    // start: aligning the end would push the beginning of the label — the part
    // that identifies it — off the left of the viewport.
    next = leadingEdge
  } else if (leadingEdge < scrollLeft) {
    next = leadingEdge
  } else if (trailingEdge > scrollLeft + viewportWidth) {
    next = trailingEdge - viewportWidth
  } else {
    return null
  }

  const clamped = clamp(next)
  return clamped === scrollLeft ? null : clamped
}
