/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { act } from 'react'

import { adminTranslations } from '@byline/i18n/admin'
import { I18nProvider } from '@byline/i18n/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Stub the uikit surface this component touches. The overflow menu is rendered
// open and inline so the assertions can read its items: base-ui's Menu portals
// into a floating layer that jsdom cannot position, and the contract under test
// is what AdminTabs puts *into* the menu, not base-ui's popup behaviour.
vi.mock('@byline/ui/react', () => ({
  Badge: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  ),
  EllipsisIcon: ({ className }: { className?: string }) => (
    <svg aria-hidden className={className} />
  ),
  Dropdown: {
    Root: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    Trigger: ({ children, ...rest }: any) => (
      <button type="button" {...rest}>
        {children}
      </button>
    ),
    Portal: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    Content: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
    Item: ({ children, onClick, ...rest }: any) => (
      <button type="button" role="menuitem" onClick={onClick} {...rest}>
        {children}
      </button>
    ),
  },
}))

// biome-ignore lint/correctness/useImportExtensions: package TS resolves via tsconfig paths
import { AdminTabs } from './tabs'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

/**
 * jsdom performs no layout, so every width is 0 and the strip would never
 * report overflow. Drive the two widths the component reads off its stable
 * override handles.
 */
const layout = { container: 0, row: 0 }

function installPointerStubs() {
  // jsdom implements neither pointer capture nor scrollTo; the component guards
  // both, and these stubs let the drag path run end to end in a test.
  HTMLElement.prototype.setPointerCapture = () => {}
  HTMLElement.prototype.releasePointerCapture = () => {}
  HTMLElement.prototype.hasPointerCapture = () => false
  Object.defineProperty(HTMLElement.prototype, 'scrollLeft', {
    configurable: true,
    get(this: HTMLElement & { _scrollLeft?: number }) {
      return this._scrollLeft ?? 0
    },
    set(this: HTMLElement & { _scrollLeft?: number }, value: number) {
      this._scrollLeft = value
    },
  })
}

/** jsdom has no PointerEvent constructor, so synthesise one from MouseEvent. */
function pointerEvent(
  type: string,
  init: { clientX?: number; pointerType?: string; button?: number }
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? 0,
    button: init.button ?? 0,
  })
  Object.defineProperty(event, 'pointerType', { value: init.pointerType ?? 'mouse' })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  return event
}

function installLayoutStubs() {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('byline-admin-tabs') ? layout.container : 0
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('byline-admin-tablist') ? layout.row : 0
    },
  })
}

const resizeCallbacks: ResizeObserverCallback[] = []
const observed: Element[] = []

class StubResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    resizeCallbacks.push(cb)
  }
  observe(target: Element) {
    observed.push(target)
  }
  unobserve() {}
  disconnect() {}
}

const TABS = [
  { name: 'details', label: 'Details' },
  { name: 'classification', label: 'Classification' },
  { name: 'bibliographic', label: 'Bibliographic' },
  { name: 'abstract', label: 'Abstract' },
]

describe('AdminTabs', () => {
  let container: HTMLDivElement
  let root: Root
  let onChange: ReturnType<typeof vi.fn>

  beforeEach(() => {
    installLayoutStubs()
    installPointerStubs()
    ;(globalThis as any).ResizeObserver = StubResizeObserver
    resizeCallbacks.length = 0
    observed.length = 0
    layout.container = 1000
    layout.row = 400
    onChange = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  const render = (props: Partial<React.ComponentProps<typeof AdminTabs>> = {}) => {
    act(() => {
      root.render(
        // The real English admin bundle rather than a stubbed `t`, so a renamed
        // or deleted key fails the test rather than passing silently.
        <I18nProvider
          bundle={adminTranslations({ locales: ['en'] })}
          activeLocale="en"
          defaultLocale="en"
          localeDefinitions={[{ code: 'en', nativeName: 'English' }]}
        >
          <AdminTabs
            idBase="tabset:main"
            tabs={props.tabs ?? TABS}
            activeTab={props.activeTab ?? 'details'}
            onChange={props.onChange ?? onChange}
            errorCounts={props.errorCounts}
          />
        </I18nProvider>
      )
    })
  }

  const tabButtons = () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  const trigger = () =>
    container.querySelector<HTMLButtonElement>('.byline-admin-tabs-overflow-trigger')
  const menuItems = () => Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'))

  it('renders every tab as a tab button', () => {
    render()

    expect(tabButtons().map((b) => b.textContent)).toEqual([
      'Details',
      'Classification',
      'Bibliographic',
      'Abstract',
    ])
  })

  it('marks the active tab as selected', () => {
    render({ activeTab: 'bibliographic' })

    const selected = tabButtons().filter((b) => b.getAttribute('aria-selected') === 'true')
    expect(selected.map((b) => b.textContent)).toEqual(['Bibliographic'])
  })

  it('does not render the overflow trigger when the row fits', () => {
    layout.row = 400
    render()

    expect(trigger()).toBeNull()
  })

  it('renders the overflow trigger when the row does not fit', () => {
    layout.row = 1600
    render()

    expect(trigger()).not.toBeNull()
  })

  /**
   * The menu is a jump list, not a remainder list. Listing only the tabs that
   * happen to be scrolled out would make the menu's contents shift under the
   * reader as they scroll.
   */
  it('lists every tab in the overflow menu, not only the hidden ones', () => {
    layout.row = 1600
    render()

    expect(menuItems().map((i) => i.textContent)).toEqual([
      'Details',
      'Classification',
      'Bibliographic',
      'Abstract',
    ])
  })

  it('labels the overflow trigger for assistive technology', () => {
    layout.row = 1600
    render()

    expect(trigger()?.getAttribute('aria-label')).toBe('All tabs')
  })

  it('selects a tab chosen from the overflow menu', () => {
    layout.row = 1600
    render()

    act(() => {
      menuItems()[2].click()
    })

    expect(onChange).toHaveBeenCalledWith('bibliographic')
  })

  it('keeps the overflow trigger outside the tablist', () => {
    layout.row = 1600
    render()

    expect(trigger()?.closest('[role="tablist"]')).toBeNull()
  })

  /**
   * The roving tabindex covers the tablist only. The overflow trigger is a
   * sibling control, not a tab, so it keeps its own place in the tab order —
   * folding it into the roving set would make it unreachable whenever the
   * active tab is not adjacent to it.
   */
  it('leaves the overflow trigger independently reachable from the keyboard', () => {
    layout.row = 1600
    render()

    expect(trigger()?.tabIndex).not.toBe(-1)
  })

  it('gives the tablist a single tab stop', () => {
    render({ activeTab: 'classification' })

    const focusable = tabButtons().filter((b) => b.tabIndex === 0)
    expect(focusable.map((b) => b.textContent)).toEqual(['Classification'])
  })

  it('moves selection to the next tab on ArrowRight', () => {
    render({ activeTab: 'classification' })

    act(() => {
      tabButtons()[1].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
      )
    })

    expect(onChange).toHaveBeenCalledWith('bibliographic')
  })

  it('moves selection to the previous tab on ArrowLeft', () => {
    render({ activeTab: 'classification' })

    act(() => {
      tabButtons()[1].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })
      )
    })

    expect(onChange).toHaveBeenCalledWith('details')
  })

  it('wraps from the first tab to the last on ArrowLeft', () => {
    render({ activeTab: 'details' })

    act(() => {
      tabButtons()[0].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })
      )
    })

    expect(onChange).toHaveBeenCalledWith('abstract')
  })

  it('jumps to the first tab on Home', () => {
    render({ activeTab: 'bibliographic' })

    act(() => {
      tabButtons()[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    })

    expect(onChange).toHaveBeenCalledWith('details')
  })

  it('jumps to the last tab on End', () => {
    render({ activeTab: 'details' })

    act(() => {
      tabButtons()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    })

    expect(onChange).toHaveBeenCalledWith('abstract')
  })

  it('associates each tab with its panel', () => {
    render()

    expect(tabButtons()[1].getAttribute('aria-controls')).toBe('tabset:main-panel-classification')
    expect(tabButtons()[1].id).toBe('tabset:main-tab-classification')
  })

  it('shows the error badge for a tab that has errors', () => {
    render({ errorCounts: { bibliographic: 2 } })

    expect(tabButtons()[2].textContent).toBe('Bibliographic2')
  })

  it('re-measures when the observed elements resize', () => {
    layout.row = 400
    render()
    expect(trigger()).toBeNull()

    layout.row = 1600
    act(() => {
      for (const cb of resizeCallbacks) cb([], {} as ResizeObserver)
    })

    expect(trigger()).not.toBeNull()
  })

  /**
   * Both the container and the tab row are observed. A label change, a badge
   * appearing, or a conditional tab unmounting alters the row's width without
   * the container's changing at all, so watching only the container would miss
   * every content-driven overflow change.
   */
  it('observes the tab row as well as the container', () => {
    render()

    const observedClasses = observed.map((el) => el.className)
    expect(observedClasses.some((c) => c.includes('byline-admin-tabs-viewport'))).toBe(false)
    expect(observedClasses.some((c) => c.includes('byline-admin-tablist'))).toBe(true)
    expect(observedClasses.some((c) => c.includes('byline-admin-tabs '))).toBe(true)
  })

  // ─── Drag-to-scroll (desktop) ─────────────────────────────────────────

  const viewport = () =>
    container.querySelector<HTMLElement>('.byline-admin-tabs-viewport') as HTMLElement

  const drag = (from: number, to: number, pointerType = 'mouse') => {
    const vp = viewport()
    act(() => {
      vp.dispatchEvent(pointerEvent('pointerdown', { clientX: from, pointerType }))
      vp.dispatchEvent(pointerEvent('pointermove', { clientX: to, pointerType }))
      vp.dispatchEvent(pointerEvent('pointerup', { clientX: to, pointerType }))
    })
  }

  it('scrolls the strip when dragged with the mouse', () => {
    layout.row = 1600
    render()
    viewport().scrollLeft = 100

    drag(300, 240)

    expect(viewport().scrollLeft).toBe(160)
  })

  it('leaves touch dragging to the browser', () => {
    layout.row = 1600
    render()
    viewport().scrollLeft = 100

    drag(300, 240, 'touch')

    expect(viewport().scrollLeft).toBe(100)
  })

  it('does not drag a strip that has no overflow', () => {
    layout.row = 400
    render()
    viewport().scrollLeft = 0

    drag(300, 240)

    expect(viewport().scrollLeft).toBe(0)
  })

  /**
   * The whole reason for the movement threshold: a plain click must still
   * select its tab.
   */
  it('still selects a tab on a click that never became a drag', () => {
    layout.row = 1600
    render()
    const vp = viewport()

    act(() => {
      vp.dispatchEvent(pointerEvent('pointerdown', { clientX: 300 }))
      vp.dispatchEvent(pointerEvent('pointermove', { clientX: 302 }))
      vp.dispatchEvent(pointerEvent('pointerup', { clientX: 302 }))
      tabButtons()[2].click()
    })

    expect(onChange).toHaveBeenCalledWith('bibliographic')
  })

  it('does not select a tab on the click that ends a drag', () => {
    layout.row = 1600
    render()

    drag(300, 240)
    act(() => {
      tabButtons()[2].click()
    })

    expect(onChange).not.toHaveBeenCalled()
  })

  /**
   * The case that a consume-once flag gets wrong. A drag released outside the
   * strip produces no click at all, so nothing arrives to clear the flag, and
   * the reader's next deliberate click on a tab would be swallowed instead.
   */
  it('selects normally on a later click when the drag produced no click', () => {
    layout.row = 1600
    render()

    drag(300, 240)

    // No click followed the drag. Time passes, then the reader clicks a tab.
    const now = performance.now()
    const clock = vi.spyOn(performance, 'now').mockReturnValue(now + 5000)
    act(() => {
      tabButtons()[2].click()
    })
    clock.mockRestore()

    expect(onChange).toHaveBeenCalledWith('bibliographic')
  })

  /** The suppression is one-shot — the next click must select normally. */
  it('selects again on the click after the drag-ending one', () => {
    layout.row = 1600
    render()

    drag(300, 240)
    act(() => {
      tabButtons()[2].click()
      tabButtons()[1].click()
    })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('classification')
  })
})
