/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { computeRevealScroll, computeStripState } from './tab-strip-geometry'

describe('computeStripState', () => {
  it('reports no overflow when the row fits the container', () => {
    const state = computeStripState({
      rowWidth: 500,
      containerWidth: 600,
      triggerWidth: 40,
      triggerGap: 8,
      scrollLeft: 0,
    })

    expect(state.overflowing).toBe(false)
  })

  /**
   * The trigger must never be the reason the trigger appears. A row that fits
   * the bare container fits, full stop — reserving the trigger's width before
   * deciding would summon a menu for tabs that were never cut off.
   */
  it('does not overflow for a row that fits the container but not the reserved width', () => {
    const state = computeStripState({
      rowWidth: 570,
      containerWidth: 600,
      triggerWidth: 40,
      triggerGap: 8,
      scrollLeft: 0,
    })

    expect(state.overflowing).toBe(false)
  })

  it('decides overflow independently of the trigger width', () => {
    const measurements = { rowWidth: 570, containerWidth: 600, triggerGap: 8, scrollLeft: 0 }

    const narrow = computeStripState({ ...measurements, triggerWidth: 0 })
    const wide = computeStripState({ ...measurements, triggerWidth: 200 })

    expect(narrow.overflowing).toBe(wide.overflowing)
  })

  it('gives the row the full container width when it is not overflowing', () => {
    const state = computeStripState({
      rowWidth: 500,
      containerWidth: 600,
      triggerWidth: 40,
      triggerGap: 8,
      scrollLeft: 0,
    })

    expect(state.viewportWidth).toBe(600)
  })

  it('takes the trigger and its gap out of the viewport once overflowing', () => {
    const state = computeStripState({
      rowWidth: 800,
      containerWidth: 600,
      triggerWidth: 40,
      triggerGap: 8,
      scrollLeft: 0,
    })

    expect(state).toMatchObject({ overflowing: true, viewportWidth: 552 })
  })

  it('treats an unmeasured container as not overflowing', () => {
    const state = computeStripState({
      rowWidth: 800,
      containerWidth: 0,
      triggerWidth: 40,
      triggerGap: 8,
      scrollLeft: 0,
    })

    expect(state.overflowing).toBe(false)
  })

  it('never reports a negative viewport when the trigger is wider than the container', () => {
    const state = computeStripState({
      rowWidth: 800,
      containerWidth: 30,
      triggerWidth: 40,
      triggerGap: 8,
      scrollLeft: 0,
    })

    expect(state.viewportWidth).toBe(0)
  })

  it('reports both edges reached when the row does not overflow', () => {
    const state = computeStripState({
      rowWidth: 500,
      containerWidth: 600,
      triggerWidth: 40,
      triggerGap: 8,
      scrollLeft: 0,
    })

    expect(state).toMatchObject({ atStart: true, atEnd: true })
  })

  it('reports the start edge only while scrolled to the left', () => {
    const state = computeStripState({
      rowWidth: 800,
      containerWidth: 600,
      triggerWidth: 40,
      triggerGap: 8,
      scrollLeft: 0,
    })

    expect(state).toMatchObject({ atStart: true, atEnd: false })
  })

  it('reports neither edge mid-scroll', () => {
    const state = computeStripState({
      rowWidth: 800,
      containerWidth: 600,
      triggerWidth: 40,
      triggerGap: 8,
      scrollLeft: 100,
    })

    expect(state).toMatchObject({ atStart: false, atEnd: false })
  })

  it('reports the end edge when scrolled fully right', () => {
    const state = computeStripState({
      rowWidth: 800,
      containerWidth: 600,
      triggerWidth: 40,
      triggerGap: 8,
      scrollLeft: 248,
    })

    expect(state).toMatchObject({ atStart: false, atEnd: true })
  })

  /**
   * Fractional layout widths are routine at non-integer device pixel ratios,
   * so a scroll position a fraction short of the end still counts as the end.
   * Without this the trailing fade never clears.
   */
  it('treats a sub-pixel shortfall as having reached the end', () => {
    const state = computeStripState({
      rowWidth: 800,
      containerWidth: 600,
      triggerWidth: 40,
      triggerGap: 8,
      scrollLeft: 247.6,
    })

    expect(state.atEnd).toBe(true)
  })
})

describe('computeRevealScroll', () => {
  const base = {
    viewportWidth: 400,
    rowWidth: 1000,
    padding: 8,
  }

  it('leaves the scroll position alone when the tab is already fully visible', () => {
    const next = computeRevealScroll({
      ...base,
      scrollLeft: 100,
      tabOffsetLeft: 150,
      tabWidth: 80,
    })

    expect(next).toBeNull()
  })

  it('scrolls left to bring a tab off the left edge into view', () => {
    const next = computeRevealScroll({
      ...base,
      scrollLeft: 200,
      tabOffsetLeft: 150,
      tabWidth: 80,
    })

    expect(next).toBe(142)
  })

  it('scrolls right to bring a tab off the right edge into view', () => {
    const next = computeRevealScroll({
      ...base,
      scrollLeft: 0,
      tabOffsetLeft: 420,
      tabWidth: 80,
    })

    expect(next).toBe(108)
  })

  it('clamps to the start rather than scrolling past it', () => {
    const next = computeRevealScroll({
      ...base,
      scrollLeft: 20,
      tabOffsetLeft: 0,
      tabWidth: 80,
    })

    expect(next).toBe(0)
  })

  it('clamps to the end rather than scrolling past it', () => {
    const next = computeRevealScroll({
      ...base,
      scrollLeft: 500,
      tabOffsetLeft: 940,
      tabWidth: 60,
    })

    expect(next).toBe(600)
  })

  /**
   * A single label can be wider than the whole strip. Aligning its right edge
   * would push the start of the label — the part that identifies it — off the
   * left of the viewport, so an over-wide tab is always aligned to its start.
   */
  it('aligns a tab wider than the viewport to its left edge', () => {
    const next = computeRevealScroll({
      ...base,
      scrollLeft: 0,
      tabOffsetLeft: 500,
      tabWidth: 450,
    })

    expect(next).toBe(492)
  })

  it('does not fight a reveal that would not move the scroll position', () => {
    const next = computeRevealScroll({
      ...base,
      scrollLeft: 0,
      tabOffsetLeft: 0,
      tabWidth: 450,
    })

    expect(next).toBeNull()
  })
})
