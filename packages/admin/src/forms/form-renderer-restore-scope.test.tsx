/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { act, useState } from 'react'

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
import { claimSaveAttempt } from './view-state/restore-session'
import { useRecordTarget } from './view-state/target-markers'

const gate = vi.hoisted(() => {
  let release: () => void = () => {}
  const opened = new Promise<void>((resolve) => {
    release = resolve
  })
  return { opened, release: () => release() }
})

// The CodeMirror chunk is held back until a test releases it, so the code
// field shows its Suspense fallback exactly as it does while the chunk loads.
vi.mock('../fields/code/code-editor', async () => {
  await gate.opened
  return {
    default: ({ id, value }: { id?: string; value?: string }) => (
      <textarea id={id} className="fake-code-editor" defaultValue={value} />
    ),
  }
})

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

defineAdminConfig({
  i18n: {
    admin: { defaultLocale: 'en', locales: ['en'] },
    content: { defaultLocale: 'en', locales: ['en', 'fr'] },
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
  { name: 'lookup', label: 'Lookup', type: 'text' as const, optional: true },
  { name: 'snippet', label: 'Snippet', type: 'code' as const, optional: true },
  { name: 'slow', label: 'Slow', type: 'text' as const, optional: true },
  { name: 'picked', label: 'Picked', type: 'text' as const, optional: true },
  { name: 'reversed', label: 'Reversed', type: 'text' as const, optional: true },
]

/**
 * An ordinary custom `components.Field` slot that knows nothing about view
 * state: a read-only value display, a local filter box and a Pick button that
 * reports the value through the `onChange` callback Byline passes in.
 */
const PickerSlot = ({
  id,
  value,
  onChange,
}: {
  id: string
  value?: string
  onChange: (value: string) => void
}) => {
  const [filter, setFilter] = useState('')
  return (
    <div>
      <input id={id} name="picked" readOnly value={value ?? ''} />
      <input name="picked-filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <button type="button" className="pick" onClick={() => onChange(`picked:${filter}`)}>
        Pick
      </button>
    </div>
  )
}

/**
 * The same picker with its filter box first in DOM order and its value
 * control second. Restoration must use the declared input id, not DOM order.
 */
const FilterFirstSlot = ({
  id,
  value,
  onChange,
}: {
  id: string
  value?: string
  onChange: (value: string) => void
}) => {
  const [filter, setFilter] = useState('')
  return (
    <div>
      <input name="reversed-filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <input id={id} name="reversed" readOnly value={value ?? ''} />
      <button type="button" className="pick-reversed" onClick={() => onChange(`picked:${filter}`)}>
        Pick
      </button>
    </div>
  )
}

/** A custom field with an auxiliary search box that edits no field value. */
const LookupField = ({ id }: { id: string }) => (
  <div>
    <input id={id} name="lookup" readOnly />
    <div data-byline-transient>
      <input name="lookup-search" />
    </div>
  </div>
)

/** A custom field whose real control never finishes loading. */
const SlowField = () => <textarea name="slow-loading" readOnly data-byline-loading />

/** A custom field that records explicitly from a button, as a picker would. */
const RecordingButton = ({ path }: { path: string }) => {
  const record = useRecordTarget()
  return (
    <button type="button" className="record-title" onClick={() => record(path, 'field')}>
      record
    </button>
  )
}

const adminConfig = {
  fields: {
    lookup: { components: { Field: LookupField } },
    slow: { components: { Field: SlowField } },
    title: { components: { afterField: RecordingButton } },
    picked: { components: { Field: PickerSlot } },
    reversed: { components: { Field: FilterFirstSlot } },
  },
}

const doc = (revision: number, versionId = `v${revision}`) => ({
  id: 'doc',
  versionId,
  revision,
  status: 'draft',
  fields: {
    title: 'Title',
    lookup: 'L',
    snippet: 'const a = 1',
    slow: '',
    picked: '',
    reversed: '',
  },
})

let containers: HTMLDivElement[] = []
let roots: Root[] = []
let outside: HTMLButtonElement

beforeEach(() => {
  outside = document.createElement('button')
  document.body.append(outside)
})

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  for (const container of containers) container.remove()
  roots = []
  containers = []
  outside.remove()
  vi.restoreAllMocks()
})

const mountRoot = () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  containers.push(container)
  const root = createRoot(container)
  roots.push(root)
  return { container, root }
}

const renderInto = (
  root: Root,
  store: EditorViewStateStore | null,
  data: Record<string, any>,
  onSubmit: () => void | Promise<void> = () => {}
) => {
  act(() => {
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
          <FormRenderer
            mode="edit"
            fields={fields as any}
            initialLocale="en"
            initialData={data}
            adminConfig={adminConfig as any}
            collectionPath="pages"
            viewState={store}
            onSubmit={onSubmit}
            onCancel={() => {}}
          />
        </BylineFieldServicesProvider>
      </I18nProvider>
    )
  })
}

const typeInto = (element: HTMLInputElement | null, value: string) => {
  if (element == null) throw new Error('input not found')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const save = async (container: HTMLElement) => {
  await act(async () => {
    container.querySelector('form')?.requestSubmit()
  })
}

const frames = async (ms = 80) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

const hostSubmit = (store: EditorViewStateStore, revision: number) => async () => {
  claimSaveAttempt(store).expectRefresh({ revision })
}

describe('restoration: loading controls', () => {
  // Must run first: once released, the lazy chunk stays loaded for the file.
  it('a code field restores to the real editor once its deferred chunk resolves, never to the loading placeholder', async () => {
    const store = createEditorViewStateStore()
    const { container, root } = mountRoot()
    renderInto(root, store, doc(1), hostSubmit(store, 2))
    expect(container.querySelector('.byline-field-code-loading')).not.toBeNull()
    typeInto(container.querySelector('input[name="title"]'), 'Edited')
    store.setTarget({ path: 'snippet', role: 'field', offset: null })
    await save(container)

    renderInto(root, store, doc(2))
    await frames(100)
    const placeholder = container.querySelector('.byline-field-code-loading')
    expect(placeholder).not.toBeNull()
    expect(document.activeElement).not.toBe(placeholder)

    await act(async () => {
      gate.release()
      await gate.opened
    })
    await frames()
    const editor = container.querySelector('.fake-code-editor')
    expect(editor).not.toBeNull()
    expect(document.activeElement).toBe(editor)
  })

  it('moving on while a control is still loading discards the restoration', async () => {
    const store = createEditorViewStateStore()
    const { container, root } = mountRoot()
    renderInto(root, store, doc(1), hostSubmit(store, 2))
    typeInto(container.querySelector('input[name="title"]'), 'Edited')
    store.setTarget({ path: 'slow', role: 'field', offset: null })
    await save(container)
    renderInto(root, store, doc(2))
    await frames(50)
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    })
    await frames(700)
    expect(document.activeElement).toBe(document.body)
  })

  it('a control that never finishes loading falls back once the bound runs out', async () => {
    const store = createEditorViewStateStore()
    const { container, root } = mountRoot()
    renderInto(root, store, doc(1), hostSubmit(store, 2))
    typeInto(container.querySelector('input[name="title"]'), 'Edited')
    store.setTarget({ path: 'slow', role: 'field', offset: null })
    await save(container)
    renderInto(root, store, doc(2))
    await frames(100)
    expect(document.activeElement).toBe(document.body)
    await frames(900)
    expect(document.activeElement).toBe(container.querySelector('.byline-form-heading'))
    expect(document.activeElement).not.toBe(container.querySelector('[name="slow-loading"]'))
  })
})

describe('recording: scope and transient inputs', () => {
  it('an edit inside a transient auxiliary input does not replace the working target', () => {
    const store = createEditorViewStateStore()
    const { container, root } = mountRoot()
    renderInto(root, store, doc(1))
    typeInto(container.querySelector('input[name="title"]'), 'Edited')
    expect(store.getTarget()?.path).toBe('title')
    typeInto(container.querySelector('input[name="lookup-search"]'), 'find me')
    expect(store.getTarget()?.path).toBe('title')
  })

  it('explicit recording measures the marker in its own form when two forms share an address', () => {
    const first = createEditorViewStateStore()
    const second = createEditorViewStateStore()
    const a = mountRoot()
    const b = mountRoot()
    renderInto(a.root, first, doc(1))
    renderInto(b.root, second, doc(1))
    const formB = b.container.querySelector('form')
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      const top = this.closest('form') === formB ? 500 : 100
      return { top, bottom: top + 20, left: 0, right: 0, width: 0, height: 20 } as DOMRect
    })
    act(() => b.container.querySelector<HTMLButtonElement>('.record-title')?.click())
    expect(second.getTarget()).toMatchObject({ path: 'title', offset: 500 })
    expect(first.getTarget()).toBeNull()
  })
})

describe('custom components.Field slots', () => {
  it('a filter edit inside a slot keeps the target; a pick through onChange records the field and restores to its editing surface', async () => {
    const store = createEditorViewStateStore()
    const { container, root } = mountRoot()
    renderInto(root, store, doc(1), hostSubmit(store, 2))
    typeInto(container.querySelector('input[name="title"]'), 'Edited')
    expect(store.getTarget()?.path).toBe('title')

    typeInto(container.querySelector('input[name="picked-filter"]'), 'abc')
    expect(store.getTarget()?.path).toBe('title')

    act(() => container.querySelector<HTMLButtonElement>('.pick')?.click())
    expect(store.getTarget()).toMatchObject({ path: 'picked', role: 'field' })
    await save(container)

    renderInto(root, store, doc(2))
    await frames()
    expect(document.activeElement).toBe(container.querySelector('input[name="picked"]'))
  })

  it('restores to the declared input id when the filter comes before the value control', async () => {
    const store = createEditorViewStateStore()
    const { container, root } = mountRoot()
    renderInto(root, store, doc(1), hostSubmit(store, 2))
    typeInto(container.querySelector('input[name="reversed-filter"]'), 'abc')
    act(() => container.querySelector<HTMLButtonElement>('.pick-reversed')?.click())
    expect(store.getTarget()).toMatchObject({ path: 'reversed', role: 'field' })
    await save(container)

    renderInto(root, store, doc(2))
    await frames()
    expect(document.activeElement).toBe(container.querySelector('input[name="reversed"]'))
  })
})

describe('advertised locales', () => {
  it('records which locale checkbox was edited', async () => {
    const store = createEditorViewStateStore()
    const { container, root } = mountRoot()
    act(() => {
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
            <FormRenderer
              mode="edit"
              fields={[{ name: 'title', label: 'Title', type: 'text' }] as any}
              initialLocale="en"
              initialData={{ ...doc(1), _availableVersionLocales: ['en', 'fr'] }}
              collectionPath="pages"
              advertiseLocales
              contentLocales={[
                { code: 'en', label: 'English' },
                { code: 'fr', label: 'French' },
              ]}
              viewState={store}
              onSubmit={() => {}}
              onCancel={() => {}}
            />
          </BylineFieldServicesProvider>
        </I18nProvider>
      )
    })
    const option = container.querySelector('[data-byline-target="$availableLocales.fr"]')
    expect(option).not.toBeNull()
    const checkbox = option?.querySelector<HTMLElement>('[role="checkbox"]')
    if (checkbox == null) throw new Error('fr checkbox not found')
    act(() => checkbox.click())
    expect(store.getTarget()).toMatchObject({ path: '$availableLocales.fr', role: 'field' })
  })
})
