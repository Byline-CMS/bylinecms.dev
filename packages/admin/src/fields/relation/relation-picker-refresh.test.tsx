/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { act } from 'react'

import { defineAdminConfig } from '@byline/core'
import { adminTranslations } from '@byline/i18n/admin'
import { I18nProvider } from '@byline/i18n/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@byline/ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const Pass = ({ children }: any) => <div>{children}</div>
  const Modal: any = ({ children, isOpen }: any) => (isOpen ? <div>{children}</div> : null)
  Modal.Container = Pass
  Modal.Header = Pass
  Modal.Content = Pass
  Modal.Actions = Pass
  return {
    ...actual,
    Modal,
    Search: ({ onSearch }: any) => (
      <input aria-label="search" onChange={(event) => onSearch?.(event.target.value)} />
    ),
    LoaderRing: () => <span />,
  }
})

import { BylineFieldServicesProvider } from '../field-services-context'
import { RelationPicker } from './relation-picker'

const globalWithAct = globalThis as any
globalWithAct.IS_REACT_ACT_ENVIRONMENT = true

defineAdminConfig({
  i18n: {
    admin: { defaultLocale: 'en', locales: ['en'] },
    content: { defaultLocale: 'en', locales: ['en'] },
  },
  collections: [
    {
      path: 'media',
      labels: { singular: 'Media item', plural: 'Media' },
      fields: [{ name: 'title', label: 'Title', type: 'text' }],
    },
  ],
  slugifier: (value: string) => value.toLowerCase().trim().replace(/\s+/g, '-'),
})

const targetDefinition = {
  path: 'media',
  labels: { singular: 'Media item', plural: 'Media' },
  useAsTitle: 'title',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
} as any

const page = (docs: Array<{ id: string; title: string }>) => ({
  docs: docs.map(({ id, title }) => ({ id, fields: { title } })),
  meta: { totalPages: 1 },
  included: { collection: { id: 'collection-1' } },
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
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

const render = async (getCollectionDocuments: any, props: Record<string, unknown> = {}) => {
  await act(async () => {
    root.render(
      <I18nProvider
        bundle={adminTranslations({ locales: ['en'] })}
        activeLocale="en"
        defaultLocale="en"
        localeDefinitions={[{ code: 'en', nativeName: 'English' }]}
      >
        <BylineFieldServicesProvider
          services={{ getCollectionDocuments, uploadField: async () => ({}) } as any}
        >
          <RelationPicker
            targetCollectionPath="media"
            targetDefinition={targetDefinition}
            displayField="title"
            isOpen={true}
            onSelect={() => {}}
            onDismiss={() => {}}
            {...(props as any)}
          />
        </BylineFieldServicesProvider>
      </I18nProvider>
    )
  })
}

const refreshButton = () =>
  container.querySelector<HTMLButtonElement>('.byline-field-relation-picker-refresh')

const rowText = () =>
  Array.from(container.querySelectorAll('.byline-field-relation-picker-rows li')).map((node) =>
    (node.textContent ?? '').trim()
  )

const search = async (value: string) => {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="search"]')
  if (input == null) throw new Error('search input not found')
  // React's `onChange` is an `input` listener, and assigning `.value` directly
  // is swallowed by its value tracker — drive the native setter.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** The request argument of the most recent list call, failing loudly if absent. */
const lastRequest = (mock: { mock: { calls: unknown[][] } }): any => {
  const call = mock.mock.calls.at(-1)
  if (call == null) throw new Error('no list request was made')
  return call[0]
}

const clickRefresh = async () => {
  await act(async () => {
    refreshButton()?.click()
  })
}

describe('relation picker refresh', () => {
  it('re-runs the query and shows a document created since the picker opened', async () => {
    let docs = [{ id: 'a', title: 'Apple' }]
    const getCollectionDocuments = vi.fn(async () => page(docs))
    await render(getCollectionDocuments)

    expect(rowText().some((text) => text.includes('Apple'))).toBe(true)
    expect(rowText().some((text) => text.includes('Banana'))).toBe(false)

    // Stands in for the editor creating a document in the other tab.
    docs = [
      { id: 'a', title: 'Apple' },
      { id: 'b', title: 'Banana' },
    ]
    await clickRefresh()

    expect(rowText().some((text) => text.includes('Banana'))).toBe(true)
  })

  /**
   * The reader may have typed a search before leaving to create the document.
   * Refresh must re-run *their* query, not reset to an unfiltered first page.
   */
  it('preserves the search term across a refresh', async () => {
    const getCollectionDocuments = vi.fn(async () => page([{ id: 'a', title: 'Apple' }]))
    await render(getCollectionDocuments)

    await search('app')
    const callsAfterSearch = getCollectionDocuments.mock.calls.length
    await clickRefresh()

    expect(getCollectionDocuments.mock.calls.length).toBeGreaterThan(callsAfterSearch)
    const lastCall = lastRequest(getCollectionDocuments)
    expect(lastCall.params.query).toBe('app')
  })

  it('preserves the current page across a refresh', async () => {
    const getCollectionDocuments = vi.fn(async () => ({
      docs: [{ id: 'a', fields: { title: 'Apple' } }],
      meta: { totalPages: 3 },
      included: { collection: { id: 'collection-1' } },
    }))
    await render(getCollectionDocuments)

    const next = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Next'
    )
    if (next == null) throw new Error('Next button not found')
    await act(async () => {
      next.click()
    })
    expect(lastRequest(getCollectionDocuments).params.page).toBe(2)
    await clickRefresh()

    expect(lastRequest(getCollectionDocuments).params.page).toBe(2)
  })

  it('keeps a multi-select choice through a refresh', async () => {
    const getCollectionDocuments = vi.fn(async () =>
      page([
        { id: 'a', title: 'Apple' },
        { id: 'b', title: 'Banana' },
      ])
    )
    const onSelectMany = vi.fn()
    await render(getCollectionDocuments, { multiple: true, onSelectMany })

    const firstChoice = container.querySelector<HTMLButtonElement>(
      '.byline-field-relation-picker-rows li button'
    )
    if (firstChoice == null) throw new Error('First choice not found')
    await act(async () => {
      firstChoice.click()
    })
    expect(firstChoice.getAttribute('aria-pressed')).toBe('true')

    await clickRefresh()

    const selected = container.querySelectorAll('[aria-pressed="true"]')
    expect(selected).toHaveLength(1)
    expect(selected[0]?.textContent).toContain('Apple')
    const confirm = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Add selected (1)'
    )
    if (confirm == null) throw new Error('Selection confirmation not found')
    await act(async () => {
      confirm.click()
    })
    expect(onSelectMany).toHaveBeenCalledExactlyOnceWith([
      {
        targetDocumentId: 'a',
        targetCollectionId: 'collection-1',
        record: { id: 'a', fields: { title: 'Apple' } },
      },
    ])
  })

  it('keeps a single choice and confirms its refreshed record', async () => {
    let title = 'Apple'
    const getCollectionDocuments = vi.fn(async () => page([{ id: 'a', title }]))
    const onSelect = vi.fn()
    await render(getCollectionDocuments, { onSelect })

    const choice = container.querySelector<HTMLButtonElement>(
      '.byline-field-relation-picker-rows li button'
    )
    if (choice == null) throw new Error('Choice not found')
    await act(async () => {
      choice.click()
    })
    expect(choice.classList.contains('byline-field-relation-picker-row-selected')).toBe(true)

    title = 'Updated Apple'
    await clickRefresh()

    const selected = container.querySelector('.byline-field-relation-picker-row-selected')
    expect(selected?.textContent).toContain('Updated Apple')
    const confirm = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Select'
    )
    if (confirm == null) throw new Error('Select button not found')
    expect(confirm.disabled).toBe(false)
    await act(async () => {
      confirm.click()
    })
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({
      targetDocumentId: 'a',
      targetCollectionId: 'collection-1',
      record: { id: 'a', fields: { title: 'Updated Apple' } },
    })
  })

  /**
   * A refresh issued while an earlier request is still in flight must win, even
   * if the earlier one resolves last. The fetch effect's `cancelled` cleanup
   * gives this for free — but only because refresh re-runs the effect rather
   * than calling the service imperatively, which would bypass it.
   */
  it('ignores a superseded request that resolves after the refresh', async () => {
    const resolvers: Array<(value: unknown) => void> = []
    const getCollectionDocuments = vi.fn(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve)
        })
    )
    await render(getCollectionDocuments)

    await clickRefresh()
    expect(resolvers.length).toBeGreaterThanOrEqual(2)

    // Resolve the newest first, then let the stale one land after it.
    await act(async () => {
      resolvers[resolvers.length - 1]?.(page([{ id: 'b', title: 'Banana' }]))
    })
    await act(async () => {
      resolvers[0]?.(page([{ id: 'a', title: 'Apple' }]))
    })

    expect(rowText().some((text) => text.includes('Banana'))).toBe(true)
    expect(rowText().some((text) => text.includes('Apple'))).toBe(false)
  })

  it('surfaces a refresh failure and recovers on a later refresh', async () => {
    let shouldFail = false
    const getCollectionDocuments = vi.fn(async () => {
      if (shouldFail) throw new Error('network down')
      return page([{ id: 'a', title: 'Apple' }])
    })
    await render(getCollectionDocuments)

    shouldFail = true
    await clickRefresh()
    expect(container.querySelector('.byline-field-relation-picker-error')).not.toBeNull()

    shouldFail = false
    await clickRefresh()
    expect(container.querySelector('.byline-field-relation-picker-error')).toBeNull()
    expect(rowText().some((text) => text.includes('Apple'))).toBe(true)
  })
})
