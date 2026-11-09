/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { act } from 'react'

import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  location: { href: '/en', publicHref: '/' } as { href: string; publicHref?: string },
}))
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: mocks.location }),
}))

import { ANALYTICS_NAVIGATION_EVENT } from '@byline/analytics-agent'

import { AnalyticsAgent } from './analytics-agent.js'

let root: Root
let container: HTMLDivElement
const navigations: unknown[] = []
const listener = (event: Event) => navigations.push((event as CustomEvent).detail)

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  navigations.length = 0
  document.addEventListener(ANALYTICS_NAVIGATION_EVENT, listener)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.removeEventListener(ANALYTICS_NAVIGATION_EVENT, listener)
  vi.unstubAllGlobals()
})

function render() {
  act(() => root.render(<AnalyticsAgent endpoint="/telemetry/events" />))
}

describe('AnalyticsAgent navigation bridge', () => {
  it('reports the public URL, not the rewritten internal href', () => {
    mocks.location = { href: '/en', publicHref: '/' }
    render()
    expect(navigations).toEqual([])

    mocks.location = { href: '/en/blog', publicHref: '/blog' }
    render()
    mocks.location = { href: '/th/blog', publicHref: '/th/blog' }
    render()
    expect(navigations).toEqual(['/blog', '/th/blog'])
  })

  it('falls back to href when the router does not provide publicHref', () => {
    mocks.location = { href: '/about' }
    render()
    mocks.location = { href: '/contact' }
    render()
    expect(navigations).toEqual(['/contact'])
  })
})
