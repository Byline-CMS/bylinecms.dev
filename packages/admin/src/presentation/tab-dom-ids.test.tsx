/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { act } from 'react'

import type { AdminResourceConfig, Field } from '@byline/core'
import { defineAdminConfig } from '@byline/core'
import { adminTranslations } from '@byline/i18n/admin'
import { I18nProvider } from '@byline/i18n/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BylineFieldServicesProvider } from '../fields/field-services-context'
import { FormProvider } from '../forms/form-context'
import { FormLayout } from '../forms/form-layout'

// Deliberately not the `;(globalThis as any)` idiom used elsewhere in this
// suite: Biome's import sorting can move an import across that leading
// semicolon, and without semicolons the result parses as a call on the import.
const globalWithAct = globalThis as any
globalWithAct.IS_REACT_ACT_ENVIRONMENT = true

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

const fields: Field[] = [
  { name: 'title', label: 'Title', type: 'text' },
  { name: 'seoTitle', label: 'SEO title', type: 'text' },
]

/**
 * Both forms declare a tab set under the same name, which is the ordinary case:
 * two forms over one collection share its admin configuration verbatim.
 */
const adminConfig = {
  layout: { main: ['main'] },
  tabSets: [
    {
      name: 'main',
      tabs: [
        { name: 'general', label: 'General', fields: ['title'] },
        { name: 'seo', label: 'SEO', fields: ['seoTitle'] },
      ],
    },
  ],
} as unknown as AdminResourceConfig

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

const Form = ({ name }: { name: string }) => (
  <form aria-label={name}>
    <FormProvider initialData={{ fields: {} }} collectionPath="pages">
      <FormLayout
        fields={fields}
        adminConfig={adminConfig}
        activeTabBySet={{ main: 'general' }}
        onTabChange={() => {}}
      />
    </FormProvider>
  </form>
)

const renderTwoForms = () => {
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
          <Form name="parent" />
          <Form name="child" />
        </BylineFieldServicesProvider>
      </I18nProvider>
    )
  })
}

describe('tab DOM ids across concurrently mounted forms', () => {
  it('keeps tab trigger ids distinct across two forms with a "main" tab set', () => {
    renderTwoForms()

    const triggers = Array.from(container.querySelectorAll('[role="tab"]')).map((n) => n.id)

    expect(triggers.length).toBeGreaterThan(0)
    expect(triggers.every((id) => id !== '')).toBe(true)
    expect(new Set(triggers).size).toBe(triggers.length)
  })

  it('labels each tab panel from a trigger in its own form', () => {
    renderTwoForms()

    const panels = Array.from(container.querySelectorAll('[role="tabpanel"]'))
    expect(panels).toHaveLength(2)

    for (const panel of panels) {
      const owner = document.getElementById(panel.getAttribute('aria-labelledby') as string)
      expect(owner).not.toBeNull()
      // Resolution is document-wide, so an unscoped id points the second form's
      // panel at the first form's trigger.
      expect(owner?.closest('form')).toBe(panel.closest('form'))
    }
  })

  it('keeps panel ids distinct so aria-controls cannot cross forms', () => {
    renderTwoForms()

    const panelIds = Array.from(container.querySelectorAll('[role="tabpanel"]')).map((n) => n.id)

    expect(panelIds.every((id) => id !== '')).toBe(true)
    expect(new Set(panelIds).size).toBe(panelIds.length)
  })
})
