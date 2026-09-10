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

// The real Modal renders through a Base UI portal; a pass-through keeps the
// rows queryable in the test container. Everything else is the shipped kit.
vi.mock('@byline/ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const Pass = ({ children }: any) => <div>{children}</div>
  const Modal: any = ({ children, isOpen }: any) =>
    isOpen ? <div data-testid="modal">{children}</div> : null
  Modal.Container = Pass
  Modal.Header = Pass
  Modal.Content = Pass
  Modal.Actions = Pass
  return { ...actual, Modal }
})

import { RankedListModal } from './ranked-list-modal.js'
import type { RankedRow } from './ranking.js'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function rows(count: number): RankedRow[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `row-${i + 1}`,
    label: `Row ${i + 1}`,
    value: count - i,
    visitors: 1,
    overflow: false,
  }))
}

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  // The kit pager's mobile toggle reads a media query; jsdom has no matchMedia.
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }))
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function render(props: Partial<React.ComponentProps<typeof RankedListModal>>) {
  await act(async () => {
    root.render(
      <I18nProvider
        bundle={adminTranslations({ locales: ['en'] })}
        activeLocale="en"
        defaultLocale="en"
        localeDefinitions={[]}
      >
        <RankedListModal
          isOpen
          onDismiss={() => {}}
          title="Countries"
          tone="visitors"
          locale="en"
          source={{ rows: [], total: 0 }}
          {...props}
        />
      </I18nProvider>
    )
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const labels = () =>
  Array.from(container.querySelectorAll('.byline-analytics-ranking-row')).map(
    (row) => row.querySelector('span')?.textContent
  )

describe('RankedListModal', () => {
  it('renders a preloaded list on the first page with a range caption', async () => {
    await render({ source: { rows: rows(55), total: 55 } })
    expect(labels()).toHaveLength(25)
    expect(labels()[0]).toBe('Row 1')
    expect(container.textContent).toContain('1–25 of 55')
  })

  it('moves to the next page when the pager is used', async () => {
    await render({ source: { rows: rows(55), total: 55 } })
    const next = container.querySelector('[aria-label="Next"]')
    expect(next).not.toBeNull()
    await act(async () => {
      ;(next as HTMLElement).click()
    })
    expect(labels()[0]).toBe('Row 26')
    expect(container.textContent).toContain('26–50 of 55')
  })

  it('loads an async source when opened and then renders it', async () => {
    let resolve!: (value: { rows: RankedRow[]; total: number }) => void
    const load = vi.fn(
      () =>
        new Promise<{ rows: RankedRow[]; total: number }>((r) => {
          resolve = r
        })
    )
    await render({ title: 'Top pages', source: load })
    expect(load).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[role="status"]')).not.toBeNull()
    await act(async () => {
      resolve({ rows: rows(3), total: 143 })
    })
    expect(labels()).toHaveLength(3)
    expect(container.textContent).toContain('1–3 of 3')
    expect(container.textContent).toContain('Top 3 of 143')
  })

  it('shows an error instead of rows when the async source fails', async () => {
    const load = vi.fn(() => Promise.reject(new Error('network')))
    await render({ title: 'Top pages', source: load })
    expect(labels()).toHaveLength(0)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Unable to load this list'
    )
  })

  it('does not call a loader while closed', async () => {
    const load = vi.fn(() => Promise.resolve({ rows: rows(1), total: 1 }))
    await render({ isOpen: false, source: load })
    expect(load).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="modal"]')).toBeNull()
  })
})
