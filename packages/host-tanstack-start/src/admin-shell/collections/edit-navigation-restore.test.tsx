/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'
import { act, useState } from 'react'

import {
  BylineFieldServicesProvider,
  createEditorViewStateStore,
  type EditorViewStateStore,
} from '@byline/admin/react'
import { defineAdminConfig, type MultiCollectionDefinition } from '@byline/core'
import { adminTranslations } from '@byline/i18n/admin'
import { I18nProvider } from '@byline/i18n/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  toastAdd: vi.fn(),
  updateStatus: vi.fn(),
  copyToLocale: vi.fn(),
  update: vi.fn(),
  unpublish: vi.fn(),
  // The guard hook's latest render: whether it blocks, and how to block.
  guard: { shouldBlock: false, block: () => {} },
}))

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
    useToastManager: () => ({ add: mocks.toastAdd }),
    Dropdown: {
      Root: Pass,
      Trigger: ({ children, render }: any) => <div>{render ?? children}</div>,
      Portal: Pass,
      Content: Pass,
      Item: ({ children, onClick, ...rest }: any) => (
        <div {...rest} onClick={onClick} onKeyDown={() => {}} role="menuitem" tabIndex={0}>
          {children}
        </div>
      ),
      Separator: () => <hr />,
    },
    Modal,
    Tooltip: Pass,
    // A split button: the primary action, then the menu trigger and its items.
    ComboButton: ({ children, onButtonClick, onOptionSelect, options, disabled }: any) => (
      <div>
        <button type="button" disabled={disabled} onClick={onButtonClick}>
          {children}
        </button>
        <button type="button" className="combo-trigger" aria-haspopup="menu" disabled={disabled}>
          more
        </button>
        {options.map((option: { value: string; label: string }) => (
          <button
            key={option.value}
            type="button"
            role="menuitem"
            onClick={() => onOptionSelect(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    ),
    Select: ({ id, name, value, items, onValueChange, ariaLabel, disabled }: any) => (
      <select
        id={id}
        name={name}
        aria-label={ariaLabel}
        disabled={disabled}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {items.map((item: { value: string; label: string }) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    ),
    Input: ({ id, name, value, onChange, disabled }: React.ComponentProps<'input'>) => (
      <input id={id} name={name} disabled={disabled} value={value ?? ''} onChange={onChange} />
    ),
  }
})

vi.mock('../../routes/admin-path.js', () => ({
  getAdminRoutePath: (...parts: string[]) => `/admin/${parts.join('/')}`,
}))

vi.mock('../../routes/list-return-storage.js', () => ({
  clearListReturnState: vi.fn(),
}))

vi.mock('../../server-fns/collections/index.js', () => ({
  cancelCollectionDocumentScheduledPublish: vi.fn(),
  confirmCollectionDocumentScheduledPublish: vi.fn(),
  copyDocumentToLocale: mocks.copyToLocale,
  deleteDocument: vi.fn(),
  deleteDocumentLocale: vi.fn(),
  duplicateCollectionDocument: vi.fn(),
  hasCommittedDocumentHookFailure: (result: { status: string }) =>
    result.status === 'committed-hook-failed',
  hasDeleteSideEffectFailures: () => false,
  scheduleCollectionDocumentPublish: vi.fn(),
  unpublishDocument: mocks.unpublish,
  updateCollectionDocumentWithPatches: mocks.update,
  updateDocumentStatus: mocks.updateStatus,
}))

vi.mock('../chrome/loose-router.js', () => ({
  useNavigate: () => mocks.navigate,
}))

// A guard that blocks a navigation while the form is dirty, as TanStack
// Router's `useBlocker` does, until the editor answers Stay or Leave.
vi.mock('./tanstack-navigation-guard.js', () => ({
  useTanStackNavigationGuard: (shouldBlock: boolean) => {
    const [blocked, setBlocked] = useState(false)
    mocks.guard.shouldBlock = shouldBlock
    mocks.guard.block = () => setBlocked(true)
    return {
      isBlocked: blocked,
      stay: () => setBlocked(false),
      proceed: () => setBlocked(false),
    }
  },
}))

vi.mock('./preview-link.js', () => ({
  PreviewLink: () => null,
}))

import { EditView } from './edit.js'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const collection = {
  path: 'docs',
  labels: { singular: 'Doc', plural: 'Docs' },
  fields: [
    { name: 'title', label: 'Title', type: 'text' },
    { name: 'summary', label: 'Summary', type: 'text', optional: true },
  ],
} as unknown as MultiCollectionDefinition

const contentLocales = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'French' },
]

const doc = (revision: number, versionId: string, overrides: Record<string, unknown> = {}) => ({
  id: 'doc-1',
  versionId,
  revision,
  status: 'draft',
  path: 'title',
  _availableVersionLocales: ['en', 'fr'],
  fields: { title: 'Title', summary: 'Summary' },
  ...overrides,
})

let container: HTMLDivElement
let root: Root
let store: EditorViewStateStore

beforeEach(() => {
  vi.clearAllMocks()
  mocks.navigate.mockImplementation(() => {
    if (mocks.guard.shouldBlock) act(() => mocks.guard.block())
  })
  defineAdminConfig({
    collections: [collection],
    slugifier: (value) => value.toLowerCase(),
    i18n: {
      admin: { defaultLocale: 'en', locales: ['en'] },
      content: { defaultLocale: 'en', locales: ['en', 'fr'] },
    },
  })
  store = createEditorViewStateStore()
  Element.prototype.scrollIntoView = vi.fn() as any
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete (Element.prototype as any).scrollIntoView
  vi.restoreAllMocks()
})

/** Renders the edit view as the route does: keyed by its content locale. */
function render(
  data: ReturnType<typeof doc>,
  /** `null` renders a URL with no locale. */
  locale: string | null = 'en',
  defaultContentLocale = 'en'
) {
  act(() =>
    root.render(
      <I18nProvider
        bundle={adminTranslations({ locales: ['en'] })}
        activeLocale="en"
        defaultLocale="en"
        localeDefinitions={[{ code: 'en', nativeName: 'English' }]}
      >
        <BylineFieldServicesProvider
          services={
            {
              getCollectionDocuments: async () => ({ docs: [], total: 0 }),
              uploadField: async () => ({}),
            } as any
          }
        >
          <EditView
            key={locale ?? ''}
            collectionDefinition={collection}
            initialData={data as never}
            locale={locale ?? undefined}
            contentLocales={contentLocales}
            defaultContentLocale={defaultContentLocale}
            viewState={store}
          />
        </BylineFieldServicesProvider>
      </I18nProvider>
    )
  )
}

function typeInto(element: HTMLInputElement | null | undefined, value: string) {
  if (element == null) throw new Error('input not found')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function choose(select: HTMLSelectElement | null, value: string) {
  if (select == null) throw new Error('select not found')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
  act(() => {
    setter?.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

const button = (text: string) => {
  const found = [...container.querySelectorAll<HTMLElement>('button, [role="menuitem"]')].find(
    (element) => element.textContent?.trim() === text
  )
  if (found == null) throw new Error(`"${text}" not found`)
  return found
}

const localeSelect = () => container.querySelector<HTMLSelectElement>('select#contentLocale')
const statusControl = () =>
  container.querySelector<HTMLElement>('[data-byline-role="action:status"] button')
const title = () => container.querySelector<HTMLInputElement>('input[name="title"]')
const saveButton = () => container.querySelector<HTMLButtonElement>('button[type="submit"]')
const lastNavigation = () => mocks.navigate.mock.calls.at(-1)?.[0]

/** Drops focus as the browser does when the focused control is disabled or removed. */
function loseFocus() {
  act(() => (document.activeElement as HTMLElement | null)?.blur())
}

describe('collection edit view: focus and scroll across in-editor navigations', () => {
  it('after a locale switch the locale selector has focus', async () => {
    render(doc(7, 'v7'))
    choose(localeSelect(), 'fr')
    expect(lastNavigation()).toMatchObject({ resetScroll: false })
    expect(lastNavigation()?.search({ locale: 'en' })).toEqual({ locale: 'fr' })
    loseFocus()

    render(doc(7, 'v7', { fields: { title: 'Titre', summary: 'Résumé' } }), 'fr')
    expect(document.activeElement).toBe(localeSelect())
  })

  it('after a status change the status control has focus and scroll is not reset', async () => {
    mocks.updateStatus.mockResolvedValueOnce({ status: 'ok', documentId: 'doc-1', revision: 8 })
    const scrollBy = vi.fn()
    window.scrollBy = scrollBy as any
    // The title field sits 200px down the viewport before the action; every
    // other marker is above it.
    let titleTop = 200
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element
    ) {
      const top = this.getAttribute('data-byline-target') === 'title' ? titleTop : -100
      return { top, bottom: top + 40, left: 0, right: 0, width: 0, height: 40 } as DOMRect
    })

    render(doc(7, 'v7'))
    const form = container.querySelector('form')
    await act(async () => {
      statusControl()?.click()
    })
    expect(mocks.updateStatus).toHaveBeenCalledTimes(1)
    expect(lastNavigation()).toMatchObject({ resetScroll: false })
    loseFocus()

    // The refreshed document arrives; the same form survives (no new version).
    titleTop = 50
    render(doc(8, 'v7', { status: 'published' }))
    expect(container.querySelector('form')).toBe(form)
    expect(document.activeElement).toBe(statusControl())
    // The anchor returns to its recorded offset.
    expect(scrollBy).toHaveBeenLastCalledWith({ top: -150, behavior: 'instant' })
  })

  it('a dirty locale switch cancelled with Stay keeps target, dirty state and visit', async () => {
    render(doc(7, 'v7'))
    typeInto(title(), 'Edited')
    const target = store.getTarget()
    expect(target?.path).toBe('title')
    expect(saveButton()?.disabled).toBe(false)

    const record = vi.spyOn(store, 'setActionRestore')
    choose(localeSelect(), 'fr')
    // The switch recorded its intent before the guard blocked it.
    expect(record).toHaveBeenCalledTimes(1)
    const stay = button('Stay on this page')
    await act(async () => {
      stay.click()
    })

    expect(store.getTarget()).toEqual(target)
    expect(saveButton()?.disabled).toBe(false)
    expect(title()?.value).toBe('Edited')
    // The recorded intent is gone: nothing restores even if that locale loads.
    expect(store.takeActionRestore({ locale: 'fr', revision: 7 })).toBeNull()
  })

  it('copy to locale clears the working target', async () => {
    mocks.copyToLocale.mockResolvedValueOnce({
      status: 'ok',
      documentId: 'doc-1',
      revision: 8,
      sourceLocale: 'en',
      targetLocale: 'fr',
      fieldsUpdated: 2,
    })
    render(doc(7, 'v7'))
    store.setTarget({ path: 'summary', role: 'field', offset: 120 })

    await act(async () => {
      button('Copy to Locale').click()
    })
    await act(async () => {
      button('Copy').click()
    })
    expect(mocks.copyToLocale).toHaveBeenCalledTimes(1)
    expect(lastNavigation()).toMatchObject({ resetScroll: false })
    expect(lastNavigation()?.search({ locale: 'en' })).toEqual({ locale: 'fr' })
    // Recording the action cleared nothing.
    expect(store.getTarget()?.path).toBe('summary')
    loseFocus()

    render(doc(8, 'v8', { fields: { title: 'Title', summary: 'Summary' } }), 'fr')
    expect(store.getTarget()).toBeNull()
    expect(document.activeElement).not.toBe(document.body)
    expect(
      (document.activeElement as HTMLElement | null)?.closest('[data-byline-role^="action:"]')
    ).not.toBeNull()
  })

  it('a locale switch whose restoration was cancelled still clears the working target', () => {
    render(doc(7, 'v7'))
    store.setTarget({ path: 'summary', role: 'field', offset: 120 })
    choose(localeSelect(), 'fr')
    // The editor moves on while the new locale loads.
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }))
    })
    loseFocus()

    render(doc(7, 'v7', { fields: { title: 'Titre', summary: 'Résumé' } }), 'fr')
    expect(store.getTarget()).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })

  it('a history-driven locale change clears the working target; staying in the locale keeps it', () => {
    render(doc(7, 'v7'))
    store.setTarget({ path: 'summary', role: 'field', offset: 120 })
    render({ ...doc(7, 'v7') })
    expect(store.getTarget()?.path).toBe('summary')

    // Back/Forward: the route renders another locale with no recorded action.
    render(doc(7, 'v7', { fields: { title: 'Titre', summary: 'Résumé' } }), 'fr')
    expect(store.getTarget()).toBeNull()
  })

  it('a delayed status refresh does not pull focus back after focus moved elsewhere', async () => {
    mocks.updateStatus.mockResolvedValueOnce({ status: 'ok', documentId: 'doc-1', revision: 8 })
    render(doc(7, 'v7'))
    await act(async () => {
      statusControl()?.click()
    })
    expect(lastNavigation()).toMatchObject({ resetScroll: false })
    // Assistive technology moves focus with no key or pointer event.
    act(() => title()?.focus())

    render(doc(8, 'v7', { status: 'published' }))
    expect(document.activeElement).toBe(title())
  })

  it('a status chosen from the split button menu returns focus to the surviving menu trigger', async () => {
    mocks.updateStatus.mockResolvedValueOnce({ status: 'ok', documentId: 'doc-1', revision: 8 })
    render(doc(7, 'v7', { status: 'published' }))
    const item = container.querySelector<HTMLElement>(
      '[data-byline-role="action:status"] [role="menuitem"]'
    )
    if (item == null) throw new Error('status menu item not found')
    act(() => item.focus())
    await act(async () => {
      item.click()
    })
    expect(mocks.updateStatus).toHaveBeenCalledTimes(1)
    // The closing menu hands focus back to its trigger: not moving on.
    act(() => container.querySelector<HTMLElement>('.combo-trigger')?.focus())
    loseFocus()

    render(doc(8, 'v7', { status: 'draft' }))
    expect(document.activeElement).toBe(container.querySelector('.combo-trigger'))
  })

  it('a long field spanning the viewport anchors the scroll position through a clamp', async () => {
    mocks.updateStatus.mockResolvedValueOnce({ status: 'ok', documentId: 'doc-1', revision: 8 })
    const scrollBy = vi.fn()
    window.scrollBy = scrollBy as any
    // No marker's top edge is in view: the summary field runs from above the
    // viewport to below it.
    let summaryTop = -300
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element
    ) {
      const path = this.getAttribute('data-byline-target')
      const [top, bottom] =
        path === 'summary' ? [summaryTop, summaryTop + 1200] : path ? [-900, -860] : [0, 0]
      return { top, bottom, left: 0, right: 100, width: 100, height: bottom - top } as DOMRect
    })

    render(doc(7, 'v7'))
    await act(async () => {
      statusControl()?.click()
    })
    loseFocus()

    // The refresh clamped the page towards the top: the field now starts lower.
    summaryTop = 300
    render(doc(8, 'v7', { status: 'published' }))
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 600, behavior: 'instant' })
  })

  it('opening without a locale and then selecting the default locale explicitly keeps the working target', () => {
    // The host's default content locale is French, and the URL has no locale.
    render(doc(7, 'v7'), null, 'fr')
    store.setTarget({ path: 'summary', role: 'field', offset: 120 })

    // The same French content, now with an explicit `?locale=fr`.
    render(doc(7, 'v7'), 'fr', 'fr')
    expect(store.getTarget()?.path).toBe('summary')
  })

  async function save() {
    const submit = saveButton()
    if (submit == null) throw new Error('save button not found')
    act(() => submit.focus())
    await act(async () => {
      submit.click()
    })
  }

  it('a pending save restoration does not cross a history navigation to another locale', async () => {
    mocks.update.mockResolvedValueOnce({
      status: 'ok',
      documentId: 'doc-1',
      documentVersionId: 'v8',
      revision: 8,
    })
    render(doc(7, 'v7'))
    typeInto(title(), 'Edited')
    await save()
    expect(mocks.update).toHaveBeenCalledTimes(1)
    loseFocus()

    // Back/Forward lands on French at the revision the English save expects.
    render(doc(8, 'v8', { fields: { title: 'Titre', summary: 'Résumé' } }), 'fr')
    expect(document.activeElement).not.toBe(title())
    expect(store.takePendingRestore(8)).toBeNull()
  })

  it('an obsolete English save settling after the switch to French restores nothing', async () => {
    let resolveSave: (value: unknown) => void = () => {}
    mocks.update.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        })
    )
    render(doc(7, 'v7'))
    typeInto(title(), 'Edited')
    await save()
    render(doc(7, 'v7', { fields: { title: 'Titre', summary: 'Résumé' } }), 'fr')
    loseFocus()

    await act(async () => {
      resolveSave({ status: 'ok', documentId: 'doc-1', documentVersionId: 'v8', revision: 8 })
    })
    render(doc(8, 'v8', { fields: { title: 'Titre', summary: 'Résumé' } }), 'fr')
    expect(document.activeElement).not.toBe(title())
    expect(store.takePendingRestore(8)).toBeNull()
  })

  it("a delayed unpublish refresh leaves focus on a different action's trigger", async () => {
    mocks.unpublish.mockResolvedValueOnce({ status: 'ok', documentId: 'doc-1', revision: 8 })
    const published = { _publishedVersion: { versionId: 'p1', status: 'published' } }
    render(doc(7, 'v7', published))
    await act(async () => {
      button('Unpublish').click()
    })
    expect(mocks.unpublish).toHaveBeenCalledTimes(1)
    // The editor moves to the status menu's trigger before the refresh lands.
    const statusTrigger = container.querySelector<HTMLElement>('.combo-trigger')
    act(() => statusTrigger?.focus())

    render(doc(8, 'v7'))
    expect(document.activeElement).toBe(statusTrigger)
  })

  it('a delayed status refresh leaves focus in an independently opened dialog', async () => {
    mocks.updateStatus.mockResolvedValueOnce({ status: 'ok', documentId: 'doc-1', revision: 8 })
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const inside = document.createElement('button')
    dialog.append(inside)
    document.body.append(dialog)
    try {
      render(doc(7, 'v7'))
      await act(async () => {
        statusControl()?.click()
      })
      act(() => inside.focus())

      render(doc(8, 'v7', { status: 'published' }))
      expect(document.activeElement).toBe(inside)
    } finally {
      dialog.remove()
    }
  })
})
