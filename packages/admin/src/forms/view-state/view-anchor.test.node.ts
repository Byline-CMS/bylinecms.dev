/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { pickViewAnchor } from './view-anchor'

const viewport = 800
const marker = (path: string, top: number, bottom: number, depth = 0) => ({
  path,
  role: 'field' as const,
  top,
  bottom,
  depth,
})

describe('pickViewAnchor', () => {
  it('prefers the topmost marker whose top edge is in the viewport', () => {
    const picked = pickViewAnchor(
      [marker('a', -400, -300), marker('b', 300, 340), marker('c', 120, 160)],
      viewport
    )
    expect(picked).toEqual({ path: 'c', role: 'field', offset: 120 })
  })

  it('between markers sharing a top edge, prefers the more specific one', () => {
    const picked = pickViewAnchor(
      [marker('content', 100, 2000, 0), marker('content[id=a]', 100, 300, 1)],
      viewport
    )
    expect(picked?.path).toBe('content[id=a]')
  })

  it('with no top edge in view, uses a long field that spans the viewport, with its signed offset', () => {
    const picked = pickViewAnchor(
      [marker('title', -600, -560), marker('body', -300, 1400), marker('after', 1500, 1540)],
      viewport
    )
    expect(picked).toEqual({ path: 'body', role: 'field', offset: -300 })
  })

  it('a spanning field nested in a spanning group wins over the group', () => {
    const picked = pickViewAnchor(
      [marker('content', -900, 3000, 0), marker('content[id=a].body', -200, 1200, 1)],
      viewport
    )
    expect(picked?.path).toBe('content[id=a].body')
  })

  it('returns null when nothing intersects the viewport', () => {
    expect(pickViewAnchor([marker('a', -500, -100), marker('b', 900, 950)], viewport)).toBeNull()
  })
})
