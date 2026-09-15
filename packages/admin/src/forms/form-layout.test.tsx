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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BylineFieldServicesProvider } from '../fields/field-services-context'
import { FormProvider } from './form-context'
import { FormLayout } from './form-layout'

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
  { name: 'featured', label: 'Featured', type: 'text' },
  { name: 'seoTitle', label: 'SEO title', type: 'text' },
]

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

const render = (props: Partial<React.ComponentProps<typeof FormLayout>> = {}) => {
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
          <FormProvider initialData={{ fields: {} }} collectionPath="pages">
            <FormLayout
              fields={fields}
              activeTabBySet={{}}
              onTabChange={() => {}}
              {...(props as any)}
            />
          </FormProvider>
        </BylineFieldServicesProvider>
      </I18nProvider>
    )
  })
}

const config = (c: Partial<AdminResourceConfig>) => c as AdminResourceConfig

describe('FormLayout regions', () => {
  it('renders main-region fields', () => {
    render({ adminConfig: config({ layout: { main: ['title'] } }) })
    expect(container.querySelector('input[name="title"]')).not.toBeNull()
  })

  it('renders layout.sidebar schema fields', () => {
    render({ adminConfig: config({ layout: { main: ['title'], sidebar: ['featured'] } }) })
    const sidebar = container.querySelector('.byline-form-sidebar')
    expect(sidebar?.querySelector('input[name="featured"]')).not.toBeNull()
    expect(container.querySelector('.byline-form-content input[name="featured"]')).toBeNull()
  })

  it('omits a region that was not requested', () => {
    render({
      adminConfig: config({ layout: { main: ['title'], sidebar: ['featured'] } }),
      regions: ['main'],
    })
    expect(container.querySelector('.byline-form-sidebar')).toBeNull()
    expect(container.querySelector('input[name="title"]')).not.toBeNull()
  })

  it('renders both regions in one column in the stacked variant', () => {
    render({
      adminConfig: config({ layout: { main: ['title'], sidebar: ['featured'] } }),
      variant: 'stacked',
    })
    expect(container.querySelector('input[name="title"]')).not.toBeNull()
    expect(container.querySelector('input[name="featured"]')).not.toBeNull()
    expect(container.querySelector('.byline-form-sidebar')).toBeNull()
  })
})

describe('FormLayout region order', () => {
  // The prop is an ordered list, and both the interface and the plan promise
  // order. Reducing it to membership checks silently always renders main first.
  const both = config({ layout: { main: ['title'], sidebar: ['featured'] } })

  const fieldOrder = () =>
    [...container.querySelectorAll('input')].map((i) => i.getAttribute('name'))

  it('honours a reversed region order in the split variant', () => {
    render({ adminConfig: both, regions: ['sidebar', 'main'] })
    expect(fieldOrder()).toEqual(['featured', 'title'])
  })

  it('honours a reversed region order in the stacked variant', () => {
    render({ adminConfig: both, regions: ['sidebar', 'main'], variant: 'stacked' })
    expect(fieldOrder()).toEqual(['featured', 'title'])
  })

  it('keeps the slot ahead of the schema fields within the sidebar', () => {
    render({
      adminConfig: both,
      regions: ['sidebar', 'main'],
      sidebarSlot: <div data-testid="path-widget" />,
    })
    const marks = [...container.querySelectorAll('input, [data-testid="path-widget"]')].map(
      (n) => n.getAttribute('data-testid') ?? n.getAttribute('name')
    )
    expect(marks).toEqual(['path-widget', 'featured', 'title'])
  })
})

describe('FormLayout stacked variant', () => {
  // The split layout's own class becomes a two-column grid at >=60rem
  // (form-renderer.module.css). Carrying it on a stacked form reserves an empty
  // second track, which defeats the one-column variant. jsdom cannot measure
  // that, so the guard is that the split class is not applied at all.
  it('does not carry the two-column split layout class', () => {
    render({
      adminConfig: config({ layout: { main: ['title'], sidebar: ['featured'] } }),
      variant: 'stacked',
    })
    const root = container.querySelector('[class*="layout"]')
    expect(root?.className).toContain('byline-form-layout-stacked')
    expect(root?.classList.contains('byline-form-layout')).toBe(false)
  })

  it('keeps the split class on the split variant', () => {
    render({ adminConfig: config({ layout: { main: ['title'] } }) })
    const root = container.querySelector('.byline-form-layout')
    expect(root).not.toBeNull()
    expect(root?.className).not.toContain('stacked')
  })
})

describe('FormLayout sidebar slot', () => {
  it('renders page-level widgets before the sidebar schema fields', () => {
    // Deliberate deviation from the plan's Task 2 test, decided by Tony:
    // the current editor renders page widgets first, and Phase 1's acceptance
    // is behaviour preservation. Reversing the order here would visibly move
    // `publishedOn` above the path widget in the shipped docs collection.
    render({
      adminConfig: config({ layout: { main: ['title'], sidebar: ['featured'] } }),
      sidebarSlot: <div data-testid="path-widget" />,
    })
    const sidebar = container.querySelector('.byline-form-sidebar')
    const order = [...(sidebar?.children ?? [])].map(
      (n) => n.getAttribute('data-testid') ?? n.querySelector('input')?.getAttribute('name') ?? '?'
    )
    expect(order).toEqual(['path-widget', 'featured'])
  })

  it('renders a sidebar for the slot even when no sidebar fields are declared', () => {
    render({
      adminConfig: config({ layout: { main: ['title'] } }),
      sidebarSlot: <div data-testid="path-widget" />,
    })
    expect(container.querySelector('[data-testid="path-widget"]')).not.toBeNull()
  })
})

describe('FormLayout tabs', () => {
  const tabbed = config({
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
  })

  it('renders the tab named by the controlled activeTabBySet prop', () => {
    render({ adminConfig: tabbed, activeTabBySet: { content: 'seo' } })
    expect(container.querySelector('input[name="seoTitle"]')).not.toBeNull()
    expect(container.querySelector('input[name="title"]')).toBeNull()
  })

  it('falls back to the first tab when the set has no selection', () => {
    render({ adminConfig: tabbed, activeTabBySet: {} })
    expect(container.querySelector('input[name="title"]')).not.toBeNull()
  })

  it('reports a tab change upward rather than selecting it itself', () => {
    // Selection stays owned above the keyed FormProvider so tab choices
    // survive the locale-change remount. FormLayout must not self-select.
    const onTabChange = vi.fn()
    render({ adminConfig: tabbed, activeTabBySet: { content: 'general' }, onTabChange })

    const seoTab = [...container.querySelectorAll('button')].find((b) => b.textContent === 'SEO')
    if (seoTab == null) throw new Error('SEO tab not found')
    act(() => {
      seoTab.click()
    })

    expect(onTabChange).toHaveBeenCalledWith('content', 'seo')
    expect(container.querySelector('input[name="seoTitle"]')).toBeNull()
  })

  it('hides a tab whose condition is unmet and falls back to a visible one', () => {
    const conditional = config({
      layout: { main: ['content'] },
      tabSets: [
        {
          name: 'content',
          tabs: [
            { name: 'general', label: 'General', fields: ['title'] },
            {
              name: 'seo',
              label: 'SEO',
              fields: ['seoTitle'],
              condition: (data: Record<string, any>) => data.title === 'show-seo',
            },
          ],
        },
      ],
    })
    render({ adminConfig: conditional, activeTabBySet: { content: 'seo' } })

    const tabLabels = [...container.querySelectorAll('button')].map((b) => b.textContent)
    expect(tabLabels).not.toContain('SEO')
    expect(container.querySelector('input[name="title"]')).not.toBeNull()
  })
})
