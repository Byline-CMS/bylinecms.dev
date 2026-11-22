/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { act } from 'react'

import { defineAdminConfig } from '@byline/core'
import { adminTranslations } from '@byline/i18n/admin'
import { I18nProvider } from '@byline/i18n/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BylineFieldServicesProvider } from '../fields/field-services-context'
import { StaticItem } from '../fields/sortable-item'
import { FormRenderer } from './form-renderer'
import {
  createEditorViewStateStore,
  type EditorViewStateStore,
} from './view-state/editor-view-state'
import { EditorViewStateContext } from './view-state/editor-view-state-context'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const fields = [
  {
    name: 'items',
    label: 'Items',
    type: 'array' as const,
    fields: [{ name: 'text', label: 'Text', type: 'text' as const }],
  },
]

defineAdminConfig({
  i18n: {
    admin: { defaultLocale: 'en', locales: ['en'] },
    content: { defaultLocale: 'en', locales: ['en', 'fr'] },
  },
  collections: [
    { path: 'pages', labels: { singular: 'Page', plural: 'Pages' }, fields: fields as any },
  ],
  slugifier: (value: string) => value.toLowerCase().trim().replace(/\s+/g, '-'),
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

const mount = (opts: {
  rendererKey: string
  store: EditorViewStateStore
  versionId?: string
  items: Array<Record<string, unknown>>
}) => {
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
            key={opts.rendererKey}
            mode="edit"
            fields={fields as any}
            initialLocale="en"
            initialData={{
              id: 'doc1',
              versionId: opts.versionId ?? 'v1',
              fields: { items: opts.items },
            }}
            collectionPath="pages"
            viewState={opts.store}
            onSubmit={() => {}}
            onCancel={() => {}}
          />
        </BylineFieldServicesProvider>
      </I18nProvider>
    )
  })
}

const frames = () => [...container.querySelectorAll('.byline-sortable')]
const collapsedFlags = () => frames().map((f) => f.classList.contains('byline-sortable-collapsed'))
const toggle = (index: number) => {
  const button = frames()[index]?.querySelector('.byline-sortable-toggle') as HTMLElement | null
  if (button == null) throw new Error(`toggle ${index} not found`)
  act(() => {
    button.click()
  })
}

const identified = [
  { _id: 'a', text: 'A' },
  { _id: 'b', text: 'B' },
]

describe('array items with a view-state store', () => {
  it('collapsed items stay collapsed after a FormProvider remount', () => {
    const store = createEditorViewStateStore()
    mount({ rendererKey: 'en', store, items: identified })
    toggle(1)
    expect(collapsedFlags()).toEqual([false, true])

    mount({ rendererKey: 'en', store, versionId: 'v2', items: identified })
    expect(collapsedFlags()).toEqual([false, true])
  })

  it('collapsed items carry across a locale remount by item id', () => {
    const store = createEditorViewStateStore()
    mount({ rendererKey: 'en', store, items: identified })
    toggle(1)
    expect(store.isCollapsed('items[id=b]')).toBe(true)

    mount({
      rendererKey: 'fr',
      store,
      items: [
        { _id: 'b', text: 'B-fr' },
        { _id: 'a', text: 'A-fr' },
      ],
    })
    expect(collapsedFlags()).toEqual([true, false])
  })

  it('an item absent from the new data starts expanded and keeps its record', () => {
    const store = createEditorViewStateStore()
    mount({ rendererKey: 'en', store, items: identified })
    toggle(1)

    mount({ rendererKey: 'fr', store, items: [{ _id: 'a', text: 'A-fr' }] })
    expect(collapsedFlags()).toEqual([false])
    expect(store.isCollapsed('items[id=b]')).toBe(true)

    mount({ rendererKey: 'de', store, items: identified })
    expect(collapsedFlags()).toEqual([false, true])
  })

  it('a collapse under a positional path is not applied after reorder', () => {
    const store = createEditorViewStateStore()
    mount({ rendererKey: 'en', store, items: [{ text: 'A' }, { text: 'B' }] })
    toggle(0)
    expect(store.isCollapsed('items[0]')).toBe(false)

    mount({ rendererKey: 'fr', store, items: [{ text: 'B' }, { text: 'A' }] })
    expect(collapsedFlags()).toEqual([false, false])
  })

  it('a legacy-shaped item without itemPath toggles locally and never writes the store', () => {
    const store = createEditorViewStateStore()
    const setCollapsed = vi.spyOn(store, 'setCollapsed')
    const isCollapsed = vi.spyOn(store, 'isCollapsed')
    act(() => {
      root.render(
        <I18nProvider
          bundle={adminTranslations({ locales: ['en'] })}
          activeLocale="en"
          defaultLocale="en"
          localeDefinitions={[{ code: 'en', nativeName: 'English' }]}
        >
          <EditorViewStateContext.Provider value={store}>
            <StaticItem label="Legacy">body</StaticItem>
          </EditorViewStateContext.Provider>
        </I18nProvider>
      )
    })
    expect(collapsedFlags()).toEqual([false])
    toggle(0)
    expect(collapsedFlags()).toEqual([true])
    toggle(0)
    expect(collapsedFlags()).toEqual([false])
    expect(setCollapsed).not.toHaveBeenCalled()
    expect(isCollapsed).not.toHaveBeenCalled()
  })
})
