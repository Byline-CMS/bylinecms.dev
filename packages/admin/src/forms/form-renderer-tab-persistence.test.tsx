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
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BylineFieldServicesProvider } from '../fields/field-services-context'
import { FormRenderer } from './form-renderer'

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

const adminConfig = {
  layout: { main: ['content'] },
  tabSets: [
    {
      name: 'content',
      tabs: [
        { name: 'general', label: 'General', fields: ['title'] },
        { name: 'seo', label: 'SEO', fields: ['seoTitle'] },
      ],
    },
  ],
}

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

const mount = (locale: string, versionId: string) => {
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
            initialLocale={locale}
            initialData={{
              id: 'doc1',
              versionId,
              fields: { title: locale, seoTitle: `${locale} SEO` },
            }}
            adminConfig={adminConfig as any}
            collectionPath="pages"
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

describe('FormRenderer tab persistence across keyed remounts', () => {
  // FormProvider is keyed on `${initialLocale}-${versionId}`, so changing either
  // remounts the whole subtree. Tab selection is lifted above that key on
  // purpose; this asserts the wiring, which a controlled-prop test on
  // FormLayout alone cannot reach.
  //
  // Adopted from the reviewer's Checkpoint 2 regression fixture.
  it('retains the selected tab through locale and version remounts', () => {
    mount('en', 'v1')

    const seoTab = [...container.querySelectorAll('[role="tab"]')].find(
      (t) => t.textContent === 'SEO'
    )
    if (seoTab == null) throw new Error('SEO tab not found')
    act(() => {
      ;(seoTab as HTMLElement).click()
    })
    const first = container.querySelector<HTMLInputElement>('input[name="seoTitle"]')
    expect(first).not.toBeNull()

    mount('fr', 'v1') // locale change remounts FormProvider via its key
    const french = container.querySelector<HTMLInputElement>('input[name="seoTitle"]')
    expect(french).not.toBeNull()
    expect(french).not.toBe(first)
    expect(french?.value).toBe('fr SEO')
    expect(selectedTabLabel()).toBe('SEO')

    mount('fr', 'v2') // version change remounts it again
    const versioned = container.querySelector<HTMLInputElement>('input[name="seoTitle"]')
    expect(versioned).not.toBeNull()
    expect(versioned).not.toBe(french)
    expect(selectedTabLabel()).toBe('SEO')
  })
})
