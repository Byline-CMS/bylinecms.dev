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
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BylineFieldServicesProvider } from '../fields/field-services-context'
import { FormRenderer } from './form-renderer'
import {
  createEditorViewStateStore,
  type EditorViewStateStore,
} from './view-state/editor-view-state'

const globalWithAct = globalThis as any
globalWithAct.IS_REACT_ACT_ENVIRONMENT = true

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
  { name: 'seoTitle', label: 'SEO title', type: 'text' as const },
]

const makeConfig = (condition?: (d: any) => boolean) => ({
  layout: { main: ['content'] },
  tabSets: [
    {
      name: 'content',
      tabs: [
        { name: 'general', label: 'General', fields: ['title'] },
        { name: 'seo', label: 'SEO', fields: ['seoTitle'], ...(condition ? { condition } : {}) },
      ],
    },
  ],
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
  title?: string
  config: any
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
              versionId: 'v1',
              fields: { title: opts.title ?? 'T', seoTitle: 'S' },
            }}
            adminConfig={opts.config as any}
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

const selectedTabLabel = () =>
  container.querySelector('[role="tab"][aria-selected="true"]')?.textContent

describe('FormRenderer tabs with a view-state store', () => {
  it('the remembered tab survives a FormRenderer remount with the same store', () => {
    const store = createEditorViewStateStore()
    const config = makeConfig()
    mount({ rendererKey: 'en', store, config })
    const seoTab = [...container.querySelectorAll('[role="tab"]')].find(
      (t) => t.textContent === 'SEO'
    )
    if (seoTab == null) throw new Error('SEO tab not found')
    act(() => {
      ;(seoTab as HTMLElement).click()
    })
    expect(store.getTab('content')).toBe('seo')

    mount({ rendererKey: 'fr', store, config }) // whole FormRenderer remounts, as on locale switch
    expect(selectedTabLabel()).toBe('SEO')
  })

  it('a hidden remembered tab falls back without overwriting the record', () => {
    const store = createEditorViewStateStore()
    store.setTab('content', 'seo')
    mount({
      rendererKey: 'a',
      store,
      title: 'hide',
      config: makeConfig((d) => d.title !== 'hide'),
    })
    expect(selectedTabLabel()).toBe('General')
    expect(store.getTab('content')).toBe('seo')
  })
})
