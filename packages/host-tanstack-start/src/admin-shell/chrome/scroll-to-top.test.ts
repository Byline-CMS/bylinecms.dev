/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { scrollWindowToTop } from './scroll-to-top.js'

function mockReducedMotion(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches, media: query })) as unknown as typeof window.matchMedia
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('scrollWindowToTop', () => {
  it('scrolls to the top of the page', () => {
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    mockReducedMotion(false)

    scrollWindowToTop()

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('skips the animation when the reader asks for reduced motion', () => {
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    mockReducedMotion(true)

    scrollWindowToTop()

    // Still goes to the top — only the travel is dropped.
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
  })

  /** Older browsers and some test environments have no `matchMedia`. */
  it('still scrolls when matchMedia is unavailable', () => {
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    vi.stubGlobal('matchMedia', undefined)

    expect(() => scrollWindowToTop()).not.toThrow()
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })
})
