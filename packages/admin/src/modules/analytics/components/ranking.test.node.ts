/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { pageWindow, regionName } from './ranking.js'

describe('pageWindow', () => {
  it('slices the first page and reports the page count', () => {
    expect(pageWindow(55, 25, 1)).toEqual({ start: 0, end: 25, pageCount: 3 })
  })

  it('shortens the last page to the remaining rows', () => {
    expect(pageWindow(55, 25, 3)).toEqual({ start: 50, end: 55, pageCount: 3 })
  })

  it('clamps a page past the end and below the start', () => {
    expect(pageWindow(55, 25, 9)).toEqual({ start: 50, end: 55, pageCount: 3 })
    expect(pageWindow(55, 25, 0)).toEqual({ start: 0, end: 25, pageCount: 3 })
  })

  it('reports one empty page for no rows', () => {
    expect(pageWindow(0, 25, 1)).toEqual({ start: 0, end: 0, pageCount: 1 })
  })
})

describe('regionName', () => {
  it('renders a known ISO code as the localised region name', () => {
    expect(regionName('TH', 'en')).toBe('Thailand')
    expect(regionName('TH', 'fr')).toBe('Thaïlande')
  })

  it('falls back to the code for unknown or malformed values', () => {
    expect(regionName('AA', 'en')).toBe('AA')
    expect(regionName('not-a-code', 'en')).toBe('not-a-code')
    expect(regionName('', 'en')).toBe('')
  })
})
