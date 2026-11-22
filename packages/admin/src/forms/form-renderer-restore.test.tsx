/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { act, StrictMode } from 'react'

import { defineAdminConfig } from '@byline/core'
import { adminTranslations } from '@byline/i18n/admin'
import { I18nProvider } from '@byline/i18n/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BylineFieldServicesProvider } from '../fields/field-services-context'
import { FormRenderer } from './form-renderer'
import {
  createEditorViewStateStore,
  type EditorViewStateStore,
} from './view-state/editor-view-state'
import { claimSaveAttempt, isRestoreLive } from './view-state/restore-session'

const hoisted = vi.hoisted(() => ({
  dragEnds: new Map<string, (move: { moveFromIndex: number; moveToIndex: number }) => void>(),
}))

// dnd-kit cannot drag in jsdom. The sortable list is replaced by one that
// exposes its `onDragEnd`, so a test drives the field's own move handler.
vi.mock('@byline/ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const Pass = ({ children }: any) => <div>{children}</div>
  return {
    ...actual,
    DraggableSortable: ({ children, onDragEnd, className, ids }: any) => {
      hoisted.dragEnds.set(String(ids?.length ?? 0), onDragEnd)
      hoisted.dragEnds.set('latest', onDragEnd)
      return <div className={className}>{children}</div>
    },
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: null,
      transition: undefined,
      isDragging: false,
    }),
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
  }
})

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

defineAdminConfig({
  i18n: {
    admin: { defaultLocale: 'en', locales: ['en'] },
    content: { defaultLocale: 'en', locales: ['en'] },
  },
  collections: [
    {
      path: 'pages',
      labels: { singular: 'Page', plural: 'Pages' },
      fields: [{ name: 'title', label: 'Title', type: 'text' }],
    },
  ],
  slugifier: (value: string) => value.toLowerCase().trim().replace(/\s+/g, '-'),
})

const fields = [
  { name: 'title', label: 'Title', type: 'text' as const },
  { name: 'summary', label: 'Summary', type: 'text' as const, optional: true },
  { name: 'notes', label: 'Notes', type: 'text' as const, optional: true },
  // Never shown: a target here is "still mounting" until the wait bound.
  {
    name: 'secret',
    label: 'Secret',
    type: 'text' as const,
    optional: true,
    condition: () => false,
  },
  {
    name: 'items',
    label: 'Items',
    type: 'array' as const,
    optional: true,
    fields: [{ name: 'label', label: 'Label', type: 'text' as const, optional: true }],
  },
]

const baseItems = [
  { _id: 'a', label: 'A' },
  { _id: 'b', label: 'B' },
  { _id: 'c', label: 'C' },
]

const doc = (revision: number, overrides: Record<string, unknown> = {}) => ({
  id: 'doc',
  versionId: `v${revision}`,
  revision,
  status: 'draft',
  fields: { title: 'Title', summary: 'S', notes: 'N', items: baseItems, ...overrides },
})

let container: HTMLDivElement
let outside: HTMLButtonElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  outside = document.createElement('button')
  outside.textContent = 'Outside the form'
  document.body.append(container, outside)
  root = createRoot(container)
  hoisted.dragEnds.clear()
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  outside.remove()
  vi.restoreAllMocks()
})

interface RenderOptions {
  store?: EditorViewStateStore | null
  data: Record<string, any>
  onSubmit: (payload: any) => void | Promise<void>
  strict?: boolean
}

const render = ({ store, data, onSubmit, strict }: RenderOptions) => {
  const form = (
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
        <FormRenderer
          mode="edit"
          fields={fields as any}
          initialLocale="en"
          initialData={data}
          collectionPath="pages"
          viewState={store}
          onSubmit={onSubmit}
          onCancel={() => {}}
        />
      </BylineFieldServicesProvider>
    </I18nProvider>
  )
  act(() => {
    root.render(strict ? <StrictMode>{form}</StrictMode> : form)
  })
}

const input = (name: string, scope: ParentNode = container) => {
  const element = scope.querySelector<HTMLInputElement>(`input[name="${name}"]`)
  if (element == null) throw new Error(`${name} input not found`)
  return element
}

const typeInto = (element: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const saveButton = () => {
  const button = container.querySelector<HTMLButtonElement>('button[type="submit"]')
  if (button == null) throw new Error('save button not found')
  return button
}

const clickSave = async () => {
  act(() => {
    saveButton().focus()
  })
  await act(async () => {
    saveButton().click()
  })
}

const submitWithEnter = async () => {
  await act(async () => {
    container.querySelector('form')?.requestSubmit()
  })
}

/** A host-shaped submit: claims the attempt and records the receipt's revision. */
const hostSubmit = (store: EditorViewStateStore, revision: number) =>
  vi.fn(async () => {
    claimSaveAttempt(store).expectRefresh({ revision })
  })

const frames = async (ms = 80) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

const marker = (path: string, role: string) =>
  [...container.querySelectorAll<HTMLElement>('[data-byline-target]')].find(
    (element) =>
      element.getAttribute('data-byline-target') === path &&
      element.getAttribute('data-byline-role') === role
  ) ?? null

describe('restoring the working target after a save', () => {
  it('edit then click Save: the field has focus after remount', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    render({ store, data: doc(1), onSubmit })
    const before = input('title')
    typeInto(before, 'Edited')
    await clickSave()
    expect(onSubmit).toHaveBeenCalledTimes(1)
    // The old instance renders revision 1 and must not consume the restoration.
    expect(document.activeElement).not.toBe(before)

    render({ store, data: doc(2, { title: 'Edited' }), onSubmit })
    const after = input('title')
    expect(after).not.toBe(before)
    expect(document.activeElement).toBe(after)
  })

  it('edit A, focus two other controls, save: A has focus', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    render({ store, data: doc(1), onSubmit })
    typeInto(input('title'), 'Edited')
    act(() => input('summary').focus())
    act(() => input('notes').focus())
    await submitWithEnter()

    render({ store, data: doc(2, { title: 'Edited' }), onSubmit })
    expect(document.activeElement).toBe(input('title'))
  })

  it('reorder then save: the moved grip has focus', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    render({ store, data: doc(1), onSubmit })
    await frames(10)
    const onDragEnd = hoisted.dragEnds.get('3')
    if (onDragEnd == null) throw new Error('items sortable not rendered')
    act(() => onDragEnd({ moveFromIndex: 0, moveToIndex: 2 }))
    expect(store.getTarget()).toMatchObject({ path: 'items[id=a]', role: 'grip' })
    await clickSave()

    render({
      store,
      data: doc(2, { items: [baseItems[1], baseItems[2], baseItems[0]] }),
      onSubmit,
    })
    await frames()
    expect(document.activeElement).toBe(marker('items[id=a]', 'grip'))
  })

  it('removing an item records the next item’s header; the last item records the previous one', async () => {
    const store = createEditorViewStateStore()
    render({ store, data: doc(1), onSubmit: () => {} })
    await frames(10)
    const removeFor = (index: number) => {
      const items = container.querySelectorAll('.byline-sortable')
      const remove = [...(items[index]?.querySelectorAll('[role="menuitem"]') ?? [])].at(-1)
      if (remove == null) throw new Error('remove item not found')
      act(() => (remove as HTMLElement).click())
    }
    removeFor(0)
    expect(store.getTarget()).toMatchObject({ path: 'items[id=b]', role: 'toggle' })
    removeFor(1)
    expect(store.getTarget()).toMatchObject({ path: 'items[id=b]', role: 'toggle' })
    removeFor(0)
    expect(store.getTarget()).toMatchObject({ path: 'items', role: 'action:add' })
  })

  it('adding an item records the new item’s first field', async () => {
    const store = createEditorViewStateStore()
    render({ store, data: doc(1, { items: [] }), onSubmit: () => {} })
    const add = marker('items', 'action:add')
    if (add == null) throw new Error('add control not marked')
    await act(async () => {
      add.click()
    })
    expect(store.getTarget()?.path).toMatch(/^items\[id=[^\]]+\]\.label$/)
    expect(store.getTarget()?.role).toBe('field')
  })

  it('collapsing an item records its toggle', async () => {
    const store = createEditorViewStateStore()
    render({ store, data: doc(1), onSubmit: () => {} })
    await frames(10)
    const toggle = marker('items[id=b]', 'toggle')
    if (toggle == null) throw new Error('toggle not marked')
    act(() => toggle.click())
    expect(store.getTarget()).toMatchObject({ path: 'items[id=b]', role: 'toggle' })
  })

  it('focus alone never records a target', () => {
    const store = createEditorViewStateStore()
    render({ store, data: doc(1), onSubmit: () => {} })
    act(() => input('summary').focus())
    expect(store.getTarget()).toBeNull()
  })

  it('refused save: no restoration, existing focus behaviour', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = vi.fn(async () => {
      throw new Error('save failed')
    })
    render({ store, data: doc(1), onSubmit })
    const title = input('title')
    typeInto(title, 'Edited')
    act(() => title.focus())
    await submitWithEnter()
    expect(onSubmit).toHaveBeenCalledTimes(1)
    // useDocumentReloadRecovery returns focus to the control the save left.
    expect(document.activeElement).toBe(title)
    expect(store.takePendingRestore(undefined)).toBeNull()
    expect(container.textContent).toContain('Cancel')
  })

  it('a delayed refresh after the user moves focus elsewhere: no restoration, focus and scroll unchanged', async () => {
    const store = createEditorViewStateStore()
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
    const onSubmit = hostSubmit(store, 2)
    render({ store, data: doc(1), onSubmit })
    typeInto(input('title'), 'Edited')
    await clickSave()

    act(() => outside.focus())
    render({ store, data: doc(2, { title: 'Edited' }), onSubmit })
    await frames()
    expect(document.activeElement).toBe(outside)
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('moving focus elsewhere while the save is in flight discards the restoration', async () => {
    const store = createEditorViewStateStore()
    let finish: () => void = () => {}
    const onSubmit = vi.fn(async () => {
      const attempt = claimSaveAttempt(store)
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      attempt.expectRefresh({ revision: 2 })
    })
    render({ store, data: doc(1), onSubmit })
    typeInto(input('title'), 'Edited')
    await clickSave()
    expect(onSubmit).toHaveBeenCalledTimes(1)

    act(() => outside.focus())
    await act(async () => {
      finish()
    })
    render({ store, data: doc(2, { title: 'Edited' }), onSubmit })
    await frames()
    expect(document.activeElement).toBe(outside)
    expect(store.takePendingRestore(2)).toBeNull()
  })

  it('a newer save that becomes eligible while an older restoration waits restores on its own notification', async () => {
    const store = createEditorViewStateStore()
    // No receipts: each restoration is eligible as soon as its save settles,
    // in the same surviving form, with no later render or notification.
    render({ store, data: doc(1), onSubmit: async () => {} })
    typeInto(input('title'), 'A')
    store.setTarget({ path: 'secret', role: 'field', offset: null })
    await submitWithEnter()
    // Restoration A is now waiting for `secret`, which never mounts.
    expect(document.activeElement).not.toBe(input('title'))

    typeInto(input('title'), 'B')
    await submitWithEnter()
    await frames()
    expect(document.activeElement).toBe(input('title'))
  })

  it('a key press before the refresh discards the restoration', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    render({ store, data: doc(1), onSubmit })
    typeInto(input('title'), 'Edited')
    await clickSave()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    render({ store, data: doc(2, { title: 'Edited' }), onSubmit })
    await frames()
    expect(document.activeElement).not.toBe(input('title'))
  })

  it('hasChanges is false after restoration', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    render({ store, data: doc(1), onSubmit })
    typeInto(input('title'), 'Edited')
    await clickSave()
    render({ store, data: doc(2, { title: 'Edited' }), onSubmit })
    expect(document.activeElement).toBe(input('title'))
    expect(container.textContent).toContain('Close')
    expect(container.textContent).not.toContain('Cancel')
    expect(saveButton().disabled).toBe(true)
  })

  it('scrolls the target back to its recorded viewport offset, instantly', async () => {
    const store = createEditorViewStateStore()
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
    let top = 300
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ top, bottom: top + 20, left: 0, right: 0, width: 0, height: 20 }) as DOMRect
    )
    const onSubmit = hostSubmit(store, 2)
    render({ store, data: doc(1), onSubmit })
    typeInto(input('title'), 'Edited')
    expect(store.getTarget()?.offset).toBe(300)
    await clickSave()

    top = 0 // the remount clamped the scroll position
    render({ store, data: doc(2, { title: 'Edited' }), onSubmit })
    expect(document.activeElement).toBe(input('title'))
    expect(scrollBy).toHaveBeenCalledWith({ top: -300, behavior: 'instant' })
  })

  it('a target that mounts one effect later is focused after a StrictMode commit replay', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    render({ store, data: doc(1), onSubmit, strict: true })
    await frames(10)
    const label = container.querySelectorAll<HTMLInputElement>('input[name="label"]')[1]
    if (label == null) throw new Error('item label not found')
    typeInto(label, 'B2')
    expect(store.getTarget()).toMatchObject({ path: 'items[id=b].label', role: 'field' })
    await clickSave()

    render({
      store,
      data: doc(2, { items: [baseItems[0], { _id: 'b', label: 'B2' }, baseItems[2]] }),
      onSubmit,
      strict: true,
    })
    // The items render one effect after the form mounted, so the first
    // attempt found no marker and is now waiting frame by frame.
    const restored = container.querySelectorAll<HTMLInputElement>('input[name="label"]')[1]
    expect(restored).toBeDefined()
    expect(document.activeElement).not.toBe(restored)
    await frames()
    expect(document.activeElement).toBe(restored)
  })

  it('unmounting while the target is still mounting discards the restoration', async () => {
    const store = createEditorViewStateStore()
    const onSubmit = hostSubmit(store, 2)
    render({ store, data: doc(1), onSubmit })
    await frames(10)
    const label = container.querySelectorAll<HTMLInputElement>('input[name="label"]')[1]
    if (label == null) throw new Error('item label not found')
    typeInto(label, 'B2')
    await clickSave()

    render({ store, data: doc(2), onSubmit })
    expect(isRestoreLive(store)).toBe(true)
    act(() => root.render(<p>elsewhere</p>))
    await frames()
    expect(document.activeElement).toBe(document.body)
    // The restoration ended with its form, so nothing stays live.
    expect(isRestoreLive(store)).toBe(false)
    // Coming back does not replay the discarded restoration.
    render({ store, data: doc(2), onSubmit })
    await frames()
    expect(document.activeElement).toBe(document.body)
  })

  it('a form without a store keeps the existing focus recovery', async () => {
    const onSubmit = vi.fn(async () => {})
    render({ store: null, data: doc(1), onSubmit })
    const title = input('title')
    typeInto(title, 'Edited')
    act(() => title.focus())
    await submitWithEnter()
    expect(document.activeElement).toBe(title)
    expect(marker('title', 'field')).not.toBeNull()
  })
})
