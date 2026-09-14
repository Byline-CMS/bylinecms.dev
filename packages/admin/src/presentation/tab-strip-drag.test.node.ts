/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import {
  advanceDrag,
  CLICK_SUPPRESSION_MS,
  DRAG_THRESHOLD_PX,
  shouldStartDrag,
  shouldSuppressClick,
} from './tab-strip-drag'

describe('shouldStartDrag', () => {
  const mouseDown = { pointerType: 'mouse', button: 0, overflowing: true }

  it('starts on a primary mouse button over an overflowing strip', () => {
    expect(shouldStartDrag(mouseDown)).toBe(true)
  })

  /**
   * Touch already scrolls the viewport natively, with momentum and rubber-band
   * behaviour no hand-rolled drag reproduces. Intercepting it would replace a
   * good interaction with a worse one.
   */
  it('leaves touch to the browser', () => {
    expect(shouldStartDrag({ ...mouseDown, pointerType: 'touch' })).toBe(false)
  })

  it('leaves pen to the browser', () => {
    expect(shouldStartDrag({ ...mouseDown, pointerType: 'pen' })).toBe(false)
  })

  it('ignores the middle button', () => {
    expect(shouldStartDrag({ ...mouseDown, button: 1 })).toBe(false)
  })

  it('ignores the secondary button, which opens the context menu', () => {
    expect(shouldStartDrag({ ...mouseDown, button: 2 })).toBe(false)
  })

  it('does nothing when the strip has no overflow to scroll', () => {
    expect(shouldStartDrag({ ...mouseDown, overflowing: false })).toBe(false)
  })
})

describe('advanceDrag', () => {
  const origin = { pointerX: 200, scrollLeft: 100 }
  const idle = { origin, dragging: false }
  const maxScroll = 400

  /**
   * Below the threshold the gesture is still a click. Scrolling here would
   * make every click on a tab nudge the strip, and suppressing the click that
   * follows would stop tabs selecting at all.
   */
  it('does not scroll before the threshold is crossed', () => {
    const next = advanceDrag(idle, 200 + (DRAG_THRESHOLD_PX - 1), maxScroll)

    expect(next).toEqual({ dragging: false, scrollLeft: null })
  })

  it('begins dragging once the pointer reaches the threshold', () => {
    const next = advanceDrag(idle, 200 + DRAG_THRESHOLD_PX, maxScroll)

    expect(next.dragging).toBe(true)
  })

  it('crosses the threshold in either direction', () => {
    const next = advanceDrag(idle, 200 - DRAG_THRESHOLD_PX, maxScroll)

    expect(next.dragging).toBe(true)
  })

  /** Dragging right pulls the content right, so the scroll offset decreases. */
  it('scrolls the content with the pointer when dragged right', () => {
    const next = advanceDrag({ origin, dragging: true }, 230, maxScroll)

    expect(next.scrollLeft).toBe(70)
  })

  it('scrolls the content with the pointer when dragged left', () => {
    const next = advanceDrag({ origin, dragging: true }, 170, maxScroll)

    expect(next.scrollLeft).toBe(130)
  })

  it('clamps at the start of the strip', () => {
    const next = advanceDrag({ origin, dragging: true }, 400, maxScroll)

    expect(next.scrollLeft).toBe(0)
  })

  it('clamps at the end of the strip', () => {
    const next = advanceDrag({ origin, dragging: true }, -400, maxScroll)

    expect(next.scrollLeft).toBe(maxScroll)
  })

  /**
   * A drag that wanders back past the threshold is still a drag — otherwise
   * returning to the origin would hand the gesture back to the click handler
   * and select whichever tab the pointer happened to end on.
   */
  it('stays a drag once it has started, even back within the threshold', () => {
    const next = advanceDrag({ origin, dragging: true }, 201, maxScroll)

    expect(next).toEqual({ dragging: true, scrollLeft: 99 })
  })
})

describe('shouldSuppressClick', () => {
  it('lets a click through when no drag has happened', () => {
    expect(shouldSuppressClick(null, 1000)).toBe(false)
  })

  /** The click the browser synthesises at the end of a drag. */
  it('suppresses the click that immediately follows a drag', () => {
    expect(shouldSuppressClick(1000, 1000)).toBe(true)
  })

  it('suppresses a click just inside the window', () => {
    expect(shouldSuppressClick(1000, 1000 + CLICK_SUPPRESSION_MS - 1)).toBe(true)
  })

  /**
   * The suppression expires on its own rather than waiting to be consumed.
   * A drag released outside the strip produces no click at all, and a flag
   * left armed would swallow the reader's next deliberate click on a tab.
   */
  it('expires rather than waiting for a click that may never come', () => {
    expect(shouldSuppressClick(1000, 1000 + CLICK_SUPPRESSION_MS)).toBe(false)
  })

  it('has long since expired by the time of a deliberate later click', () => {
    expect(shouldSuppressClick(1000, 3000)).toBe(false)
  })
})
