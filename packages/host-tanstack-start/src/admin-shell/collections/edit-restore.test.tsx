/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'
import { act } from 'react'

import {
  BylineFieldServicesProvider,
  createEditorViewStateStore,
  type EditorViewStateStore,
} from '@byline/admin/react'
import {
  defineAdminConfig,
  ERR_DOCUMENT_HOOK_COMMITTED,
  type MultiCollectionDefinition,
  SINGLE_STATUS_WORKFLOW,
} from '@byline/core'
import { adminTranslations } from '@byline/i18n/admin'
import { I18nProvider } from '@byline/i18n/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  toastAdd: vi.fn(),
  update: vi.fn(),
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
      Item: ({ children, onClick }: any) => (
        <div onClick={onClick} onKeyDown={() => {}} role="menuitem" tabIndex={0}>
          {children}
        </div>
      ),
      Separator: () => <hr />,
    },
    Modal,
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
  copyDocumentToLocale: vi.fn(),
  deleteDocument: vi.fn(),
  deleteDocumentLocale: vi.fn(),
  duplicateCollectionDocument: vi.fn(),
  hasCommittedDocumentHookFailure: (result: { status: string }) =>
    result.status === 'committed-hook-failed',
  hasDeleteSideEffectFailures: () => false,
  scheduleCollectionDocumentPublish: vi.fn(),
  unpublishDocument: vi.fn(),
  updateCollectionDocumentWithPatches: mocks.update,
  updateDocumentStatus: vi.fn(),
}))

vi.mock('../chrome/loose-router.js', () => ({
  useNavigate: () => mocks.navigate,
}))

vi.mock('./tanstack-navigation-guard.js', () => ({
  useTanStackNavigationGuard: () => ({ isBlocked: false, stay: () => {}, proceed: () => {} }),
}))

vi.mock('./view-menu.js', () => ({
  ViewMenu: () => null,
}))

import { EditView } from './edit.js'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const collection = {
  path: 'docs',
  labels: { singular: 'Doc', plural: 'Docs' },
  workflow: SINGLE_STATUS_WORKFLOW,
  useAsPath: 'title',
  fields: [
    { name: 'title', label: 'Title', type: 'text' },
    {
      name: 'content',
      label: 'Content',
      type: 'blocks',
      optional: true,
      blocks: [
        {
          blockType: 'textBlock',
          label: 'Text',
          fields: [{ name: 'heading', label: 'Heading', type: 'text', optional: true }],
        },
      ],
    },
  ],
} as unknown as MultiCollectionDefinition

const blocks = [
  { _id: 'b1', _type: 'textBlock', heading: 'One' },
  { _id: 'b2', _type: 'textBlock', heading: 'Two' },
]

const doc = (revision: number, versionId: string, overrides: Record<string, unknown> = {}) => ({
  id: 'doc-1',
  versionId,
  revision,
  status: 'published',
  path: 'title',
  fields: { title: 'Title', content: blocks, ...overrides },
})

const committedError = (revision: number) =>
  ERR_DOCUMENT_HOOK_COMMITTED({
    message: 'Test failure',
    details: {
      phase: 'afterUpdate',
      documentId: 'doc-1',
      documentVersionId: `v${revision}`,
      revision,
      sideEffectCode: 'ERR_UNHANDLED',
    },
  })

let container: HTMLDivElement
let root: Root
let store: EditorViewStateStore
let scrollIntoView: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mocks.update.mockResolvedValue({
    status: 'ok',
    documentId: 'doc-1',
    documentVersionId: 'v8',
    revision: 8,
  })
  defineAdminConfig({
    collections: [collection],
    slugifier: (value) => value.toLowerCase(),
    i18n: {
      admin: { defaultLocale: 'en', locales: ['en'] },
      content: { defaultLocale: 'en', locales: ['en'] },
    },
  })
  store = createEditorViewStateStore()
  scrollIntoView = vi.fn()
  Element.prototype.scrollIntoView = scrollIntoView as any
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete (Element.prototype as any).scrollIntoView
})

function render(data: ReturnType<typeof doc>, key = 'en') {
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
            key={key}
            collectionDefinition={collection}
            initialData={data as never}
            locale="en"
            contentLocales={[{ code: 'en', label: 'English' }]}
            defaultContentLocale="en"
            viewState={store}
          />
        </BylineFieldServicesProvider>
      </I18nProvider>
    )
  )
}

const frames = async (ms = 80) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

function typeInto(element: HTMLInputElement | null | undefined, value: string) {
  if (element == null) throw new Error('input not found')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const title = () => container.querySelector<HTMLInputElement>('input[name="title"]')
const headings = () => container.querySelectorAll<HTMLInputElement>('input[name="heading"]')
const pathInput = () => container.querySelector<HTMLInputElement>('input[name="__systemPath__"]')
const warning = () => container.querySelector<HTMLElement>('.byline-document-concurrency')

async function save() {
  const button = container.querySelector<HTMLButtonElement>('button[type="submit"]')
  if (button == null) throw new Error('save button not found')
  act(() => button.focus())
  await act(async () => {
    button.click()
  })
}

describe('collection edit view: restoring the working target after a save', () => {
  it('thrown committed path: the warning has focus and is visible', async () => {
    mocks.update.mockRejectedValueOnce(committedError(8))
    render(doc(7, 'v7'))
    typeInto(title(), 'Edited')
    await save()
    expect(mocks.navigate).toHaveBeenCalled()

    render(doc(8, 'v8', { title: 'Edited' }))
    expect(warning()).not.toBeNull()
    expect(document.activeElement).toBe(warning())
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest', behavior: 'instant' })
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(warning())
  })

  it('a thrown committed warning followed by an ordinary successful save in the same visit: the second save focuses the working target, not the warning', async () => {
    mocks.update.mockRejectedValueOnce(committedError(8))
    render(doc(7, 'v7'))
    typeInto(title(), 'Edited')
    await save()
    render(doc(8, 'v8', { title: 'Edited' }))
    expect(document.activeElement).toBe(warning())

    mocks.update.mockResolvedValueOnce({
      status: 'ok',
      documentId: 'doc-1',
      documentVersionId: 'v9',
      revision: 9,
    })
    typeInto(title(), 'Edited again')
    await save()
    render(doc(9, 'v9', { title: 'Edited again' }))
    // The warning is still shown (the issue is never cleared), but it is not
    // where this save's restoration sends focus.
    expect(warning()).not.toBeNull()
    expect(document.activeElement).toBe(title())
  })

  it('a returned committed-hook-failed result restores like success', async () => {
    mocks.update.mockResolvedValueOnce({
      status: 'committed-hook-failed',
      documentId: 'doc-1',
      documentVersionId: 'v8',
      revision: 8,
      sideEffectFailure: { phase: 'afterUpdate', code: 'ERR_UNHANDLED' },
    })
    render(doc(7, 'v7'))
    typeInto(title(), 'Edited')
    await save()
    render(doc(8, 'v8', { title: 'Edited' }))
    expect(document.activeElement).toBe(title())
  })

  it('path-only save restores focus to the path control exactly once, after confirmation, without a remount', async () => {
    mocks.update.mockResolvedValueOnce({ status: 'ok', documentId: 'doc-1', revision: 8 })
    render(doc(7, 'v7'))
    const form = container.querySelector('form')
    typeInto(pathInput(), 'renamed')
    await save()

    const confirm = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Save Changes'
    )
    if (confirm == null) throw new Error('confirmation not shown')
    expect(mocks.update).not.toHaveBeenCalled()
    act(() => confirm.focus())
    await act(async () => {
      confirm.click()
    })
    expect(mocks.update).toHaveBeenCalledTimes(1)

    let focusCount = 0
    const path = pathInput()
    path?.addEventListener('focus', () => focusCount++)
    render(doc(8, 'v7', { title: 'Title' }))
    expect(container.querySelector('form')).toBe(form)
    expect(pathInput()).toBe(path)
    expect(document.activeElement).toBe(path)
    render({ ...doc(8, 'v7'), status: 'published' })
    await frames()
    expect(focusCount).toBe(1)
  })

  it('surviving metadata: a path-only save re-rendering the same instance with the new revision consumes once', async () => {
    mocks.update.mockResolvedValueOnce({ status: 'ok', documentId: 'doc-1', revision: 8 })
    const take = vi.spyOn(store, 'takePendingRestore')
    render(doc(7, 'v7'))
    const form = container.querySelector('form')
    typeInto(pathInput(), 'renamed')
    await save()
    const confirm = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Save Changes'
    )
    await act(async () => {
      confirm?.click()
    })
    expect(take.mock.results.every((result) => result.value === null)).toBe(true)

    render(doc(8, 'v7'))
    render({ ...doc(8, 'v7') })
    render({ ...doc(8, 'v7') })
    expect(container.querySelector('form')).toBe(form)
    expect(take.mock.results.filter((result) => result.value != null)).toHaveLength(1)
    expect(document.activeElement).toBe(pathInput())
  })

  it('delayed content: the old instance never consumes; restoration waits until the rendered revision reaches the receipt', async () => {
    render(doc(7, 'v7'))
    const before = title()
    typeInto(before, 'Edited')
    await save()

    // The loader lags: several renders still carry revision 7.
    render({ ...doc(7, 'v7') })
    render({ ...doc(7, 'v7'), status: 'published' })
    await frames()
    expect(title()).toBe(before)
    expect(document.activeElement).not.toBe(before)

    render(doc(8, 'v8', { title: 'Edited' }))
    expect(title()).not.toBe(before)
    expect(document.activeElement).toBe(title())
  })

  it('a target whose block populates one effect after mount is focused, not replaced by a fallback', async () => {
    render(doc(7, 'v7'))
    await frames(10)
    typeInto(headings()[1], 'Two edited')
    await save()

    render(doc(8, 'v8', { content: [blocks[0], { ...blocks[1], heading: 'Two edited' }] }))
    const target = headings()[1]
    expect(target).toBeDefined()
    // Still waiting for the block's own render to settle: nothing focused yet.
    expect(document.activeElement).not.toBe(target)
    await frames()
    expect(document.activeElement).toBe(target)
  })

  it('a target whose item is gone from the saved data falls back immediately, without waiting out the bound', async () => {
    render(doc(7, 'v7'))
    await frames(10)
    typeInto(headings()[1], 'Two edited')
    await save()

    render(doc(8, 'v8', { content: [blocks[0]] }))
    // No frames have passed: the fallback was chosen in the same commit.
    const focused = document.activeElement as HTMLElement | null
    expect(focused).not.toBe(document.body)
    // The blocks field's own add control, never the surviving neighbour block.
    expect(focused?.getAttribute('data-byline-target')).toBe('content')
    expect(focused?.getAttribute('data-byline-role')).toBe('action:add')
    expect(focused?.closest('.byline-sortable')).toBeNull()
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(focused)
  })

  it('a late callback from an older save cannot mark or overwrite a newer save’s receipt', async () => {
    let rejectFirst: (reason: unknown) => void = () => {}
    mocks.update.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectFirst = reject
        })
    )
    render(doc(7, 'v7'), 'first')
    typeInto(title(), 'First')
    await save()
    expect(mocks.update).toHaveBeenCalledTimes(1)

    // The editor view remounts (as on a locale switch) while that save is
    // still in flight, and a newer save begins in the same visit.
    render(doc(7, 'v7'), 'second')
    let resolveSecond: (value: unknown) => void = () => {}
    mocks.update.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve
        })
    )
    typeInto(title(), 'Second')
    await save()
    expect(mocks.update).toHaveBeenCalledTimes(2)

    // While the newer save is in flight, the older one fails late through the
    // committed-warning path: it must not flag the newer save's warning or
    // replace its receipt revision.
    await act(async () => {
      rejectFirst(committedError(99))
    })
    await act(async () => {
      resolveSecond({ status: 'ok', documentId: 'doc-1', documentVersionId: 'v8', revision: 8 })
    })

    render(doc(8, 'v8', { title: 'Second' }), 'second')
    expect(document.activeElement).toBe(title())
  })
})
