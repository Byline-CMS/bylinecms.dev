/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'
import { act } from 'react'

import { defineAdminConfig, defineSingleton, type MultiCollectionDefinition } from '@byline/core'
import { createRoot } from 'react-dom/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const abilityState = vi.hoisted(() => ({
  isSuperAdmin: false,
  abilities: [] as string[],
}))

vi.mock('../../integrations/abilities.jsx', () => ({
  useAbilities: () => ({
    isSuperAdmin: abilityState.isSuperAdmin,
    abilities: abilityState.abilities,
    has: () => false,
    hasAny: () => false,
  }),
}))

vi.mock('@byline/i18n/react', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
      if (key === 'dashboard.totalCount') return `${values?.count} total`
      if (key === 'dashboard.collectionDescription') return `Manage ${values?.label}`
      return key
    },
  }),
}))

vi.mock('@byline/ui/react', () => {
  type Props = { children?: React.ReactNode; className?: string }
  const element = (tag: keyof React.JSX.IntrinsicElements) =>
    function Element({ children, ...props }: Props) {
      const Component = tag
      return <Component {...props}>{children}</Component>
    }
  const Card = element('article') as ReturnType<typeof element> & {
    Header: ReturnType<typeof element>
    Title: ReturnType<typeof element>
    Description: ReturnType<typeof element>
    Content: ReturnType<typeof element>
  }
  Card.Header = element('header')
  Card.Title = element('h3')
  Card.Description = element('p')
  Card.Content = element('div')
  return { Card, Container: element('div'), Section: element('section') }
})

vi.mock('./loose-router.js', () => ({
  Link: ({
    to = '',
    params = {},
    search: _search,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    to?: string
    params?: Record<string, string>
    search?: unknown
  }) => {
    let href = to
    for (const [name, value] of Object.entries(params)) {
      href = href.replace(`$${name}`, value)
    }
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))

import { AdminDashboard } from './dashboard.js'

const articles: MultiCollectionDefinition = {
  path: 'articles',
  labels: { singular: 'Article', plural: 'Articles' },
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
  showStats: true,
}

const settings = defineSingleton({
  path: 'site-settings',
  label: 'Site settings',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
})

function renderDashboard(statsMap: Record<string, Array<{ status: string; count: number }>> = {}) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => root.render(<AdminDashboard statsMap={statsMap} />))
  return {
    container,
    dispose() {
      act(() => root.unmount())
      container.remove()
    },
  }
}

describe('AdminDashboard document resources', () => {
  beforeAll(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterAll(() => {
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT
  })

  beforeEach(() => {
    abilityState.isSuperAdmin = false
    abilityState.abilities = []
    defineAdminConfig({
      routes: { admin: '/internal/cms' },
      collections: [articles, settings],
      admin: [
        { slug: articles.path, group: 'content' },
        { singleton: true, slug: settings.path, group: 'content' },
      ],
      collectionGroups: [{ name: 'content', label: 'Content' }],
      i18n: {
        admin: { defaultLocale: 'en', locales: [] },
        content: { defaultLocale: 'en', locales: [] },
      },
    })
  })

  it('shows a singleton only for its kind-aware read ability', () => {
    abilityState.abilities = ['singletons.site-settings.read']
    const allowed = renderDashboard()
    expect(allowed.container.textContent).toContain('Site settings')
    expect(allowed.container.textContent).not.toContain('Articles')
    allowed.dispose()

    abilityState.abilities = ['collections.site-settings.read']
    const staleNamespace = renderDashboard()
    expect(staleNamespace.container.textContent).not.toContain('Site settings')
    staleNamespace.dispose()
  })

  it('shows both resource kinds to a super admin in registry order', () => {
    abilityState.isSuperAdmin = true
    const view = renderDashboard({ articles: [{ status: 'draft', count: 3 }] })

    const titles = [...view.container.querySelectorAll('.byline-dashboard-title-text')].map(
      (element) => element.textContent
    )
    expect(titles).toEqual(['Articles', 'Site settings'])
    expect(view.container.querySelector('.byline-dashboard-group-heading')?.textContent).toBe(
      'Content'
    )
    view.dispose()
  })

  it('links a singleton under the custom admin base without collection stats', () => {
    abilityState.isSuperAdmin = true
    const view = renderDashboard({
      articles: [{ status: 'draft', count: 3 }],
      'site-settings': [{ status: 'published', count: 99 }],
    })

    const link = view.container.querySelector<HTMLAnchorElement>(
      'a[href="/internal/cms/singletons/site-settings"]'
    )
    const card = link?.closest('article')
    expect(link).not.toBeNull()
    expect(card?.querySelector('.byline-dashboard-stat-tile')).toBeNull()
    expect(card?.querySelector('.byline-dashboard-title-meta')).toBeNull()
    expect(card?.textContent).not.toContain('99')
    expect(card?.textContent?.match(/Manage Site settings/g)).toHaveLength(1)
    expect(
      view.container.querySelector('a[href="/internal/cms/collections/articles"]')
    ).not.toBeNull()
    expect(view.container.querySelector('.byline-dashboard-stat-tile')).not.toBeNull()
    view.dispose()
  })

  it('hides an update-only singleton role from the dashboard', () => {
    abilityState.abilities = ['singletons.site-settings.update']
    const view = renderDashboard()
    expect(view.container.textContent).not.toContain('Site settings')
    view.dispose()
  })
})
