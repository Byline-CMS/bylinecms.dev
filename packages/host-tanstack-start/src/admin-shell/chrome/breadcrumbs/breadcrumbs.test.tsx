/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { act, type ComponentProps, type ReactNode } from 'react'

import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../loose-router.js', () => ({
  Link: ({ to, children, ...rest }: { to?: string; children?: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('@byline/i18n/react', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@byline/ui/react', () => ({
  EllipsisIcon: (props: ComponentProps<'span'>) => <span {...props} />,
  Dropdown: {
    Root: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    Trigger: ({ children, ...rest }: ComponentProps<'button'>) => (
      <button type="button" {...rest}>
        {children}
      </button>
    ),
    Portal: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    Content: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    Item: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  },
}))

const { Breadcrumbs } = await import('./breadcrumbs.js')
const { BreadcrumbsProvider, useBreadcrumbs } = await import('./breadcrumbs-provider.js')
type Breadcrumb = import('./@types.js').Breadcrumb

// jsdom performs no layout, so every width would read as 0 and the collapse
// branch could never be exercised. Derive a deterministic width from rendered
// text instead, and let each test drive the container width directly.
const CHAR_WIDTH = 10
const ITEM_PADDING = 20
let containerWidth = 1000
let resizeCallbacks: Array<() => void> = []

function installLayoutStubs() {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return (this.textContent?.length ?? 0) * CHAR_WIDTH + ITEM_PADDING
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.tagName === 'NAV' ? containerWidth : 0
    },
  })
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    () => ({ gap: '4px' }) as unknown as CSSStyleDeclaration
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback)
      }
      observe() {}
      disconnect() {}
    }
  )
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  containerWidth = 1000
  resizeCallbacks = []
  installLayoutStubs()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Labels in the live trail, excluding the hidden measurement layer. */
function visibleLabels(): string[] {
  const list = container.querySelector('nav > ul')
  if (!list) return []
  return [...list.querySelectorAll('li')].map((li) => li.textContent?.trim() ?? '')
}

function isCollapsed(): boolean {
  return container.querySelector('nav > ul button') != null
}

const trail = (n: number): Breadcrumb[] =>
  Array.from({ length: n }, (_, i) => ({ label: `Section${i}`, href: `/section-${i}` }))

describe('breadcrumbs provider equality', () => {
  it('keeps the previous settings object when equivalent breadcrumbs are submitted', () => {
    const received: unknown[] = []
    function Consumer() {
      const { breadCrumbSettings } = useBreadcrumbs()
      received.push(breadCrumbSettings)
      return null
    }
    let setBreadcrumbs!: ReturnType<typeof useBreadcrumbs>['setBreadcrumbs']
    function Setter() {
      setBreadcrumbs = useBreadcrumbs().setBreadcrumbs
      return null
    }
    act(() =>
      root.render(
        <BreadcrumbsProvider>
          <Setter />
          <Consumer />
        </BreadcrumbsProvider>
      )
    )

    const settings = {
      homeLabel: 'Home',
      homePath: '/admin',
      breadcrumbs: [{ label: 'Dashboard', href: '/admin' }],
    }
    act(() => setBreadcrumbs(settings))
    const afterFirst = received.length

    // A deep-equal but freshly allocated value — exactly what a route
    // component produces on every render from an inline array literal.
    act(() =>
      setBreadcrumbs({
        homeLabel: 'Home',
        homePath: '/admin',
        breadcrumbs: [{ label: 'Dashboard', href: '/admin' }],
      })
    )

    expect(received.length).toBe(afterFirst)
    expect(received.at(-1)).toBe(received[afterFirst - 1])
  })

  it('propagates a new settings object when a breadcrumb label actually changes', () => {
    const received: unknown[] = []
    function Consumer() {
      received.push(useBreadcrumbs().breadCrumbSettings)
      return null
    }
    let setBreadcrumbs!: ReturnType<typeof useBreadcrumbs>['setBreadcrumbs']
    function Setter() {
      setBreadcrumbs = useBreadcrumbs().setBreadcrumbs
      return null
    }
    act(() =>
      root.render(
        <BreadcrumbsProvider>
          <Setter />
          <Consumer />
        </BreadcrumbsProvider>
      )
    )

    act(() => setBreadcrumbs({ breadcrumbs: [{ label: 'Dashboard', href: '/admin' }] }))
    const afterFirst = received.length
    act(() => setBreadcrumbs({ breadcrumbs: [{ label: 'Renamed', href: '/admin' }] }))

    expect(received.length).toBeGreaterThan(afterFirst)
  })

  it('exposes a stable setter so consumer effects do not refire', () => {
    const setters = new Set<unknown>()
    function Consumer() {
      setters.add(useBreadcrumbs().setBreadcrumbs)
      return null
    }
    let setBreadcrumbs!: ReturnType<typeof useBreadcrumbs>['setBreadcrumbs']
    function Setter() {
      setBreadcrumbs = useBreadcrumbs().setBreadcrumbs
      return null
    }
    act(() =>
      root.render(
        <BreadcrumbsProvider>
          <Setter />
          <Consumer />
        </BreadcrumbsProvider>
      )
    )
    act(() => setBreadcrumbs({ breadcrumbs: [{ label: 'Dashboard', href: '/admin' }] }))
    act(() => setBreadcrumbs({ breadcrumbs: [{ label: 'Renamed', href: '/admin' }] }))

    expect(setters.size).toBe(1)
  })
})

describe('breadcrumbs measurement', () => {
  it('re-measures when only the home label changes', () => {
    const breadcrumbs = trail(5)
    containerWidth = 700
    act(() => root.render(<Breadcrumbs breadcrumbs={breadcrumbs} homeLabel="Home" />))
    expect(isCollapsed()).toBe(false)

    // Same array reference; only the home label grows. Its width feeds the
    // same calculation, so the trail must collapse.
    act(() =>
      root.render(
        <Breadcrumbs breadcrumbs={breadcrumbs} homeLabel="A considerably longer home label" />
      )
    )

    expect(isCollapsed()).toBe(true)
  })

  it('expands a collapsed trail when it is replaced by a shorter one', () => {
    containerWidth = 260
    act(() => root.render(<Breadcrumbs breadcrumbs={trail(6)} homeLabel="Home" />))
    expect(isCollapsed()).toBe(true)

    act(() => root.render(<Breadcrumbs breadcrumbs={trail(2)} homeLabel="Home" />))

    expect(isCollapsed()).toBe(false)
    expect(visibleLabels()).toEqual(['Home', 'Section0', 'Section1'])
  })

  it('re-measures when labels change without changing the breadcrumb count', () => {
    containerWidth = 600
    act(() => root.render(<Breadcrumbs breadcrumbs={trail(4)} homeLabel="Home" />))
    const before = isCollapsed()

    const longer: Breadcrumb[] = trail(4).map((b, i) => ({
      ...b,
      label: `${b.label} with a much longer label ${i}`,
    }))
    act(() => root.render(<Breadcrumbs breadcrumbs={longer} homeLabel="Home" />))

    expect(before).toBe(false)
    expect(isCollapsed()).toBe(true)
  })

  it('collapses and expands across a resize', () => {
    const breadcrumbs = trail(6)
    containerWidth = 1000
    act(() => root.render(<Breadcrumbs breadcrumbs={breadcrumbs} homeLabel="Home" />))
    expect(isCollapsed()).toBe(false)

    containerWidth = 260
    act(() => {
      for (const cb of resizeCallbacks) cb()
    })
    expect(isCollapsed()).toBe(true)

    containerWidth = 1000
    act(() => {
      for (const cb of resizeCallbacks) cb()
    })
    expect(isCollapsed()).toBe(false)
  })
})
