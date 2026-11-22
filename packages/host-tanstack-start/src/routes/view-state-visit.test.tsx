/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { act } from 'react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'

import type { EditorViewStateStore } from '@byline/admin/react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A real router and a real route component. Only the loader's server function
// and the editor view are replaced; the view is a probe that records the store
// it is given and counts mounts, so remounts from the locale key are visible.
const mocks = vi.hoisted(() => ({
  rootRoute: null as unknown,
  mounts: 0,
  stores: [] as Array<EditorViewStateStore | undefined>,
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    createFileRoute: (path: string) => (options: Record<string, unknown>) =>
      actual.createRoute({
        getParentRoute: () => mocks.rootRoute as never,
        path,
        ...options,
      } as never),
  }
})

vi.mock('@byline/core', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCollectionAdminConfig: () => null,
}))

vi.mock('@byline/i18n/react', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@byline/ui/react', () => ({ useToastManager: () => ({ add: vi.fn() }) }))
vi.mock('../admin-shell/chrome/breadcrumbs/breadcrumbs-client.js', () => ({
  BreadcrumbsClient: () => null,
}))
vi.mock('../admin-shell/chrome/loose-router.js', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../server-fns/collections/index.js', () => ({
  getCollectionDocument: async (_collection: string, id: string) => ({ id, fields: {} }),
}))
vi.mock('./get-multi-collection-definition.js', () => ({
  getMultiCollectionDefinition: (path: string) => ({
    path,
    labels: { singular: 'Page', plural: 'Pages' },
    fields: [],
  }),
}))
vi.mock('./admin-path.js', () => ({
  getAdminRoutePath: (...parts: string[]) => `/admin/${parts.join('/')}`,
}))
vi.mock('./relation-projections.js', () => ({ getRelationProjections: () => undefined }))
vi.mock('./get-content-locale-route-config.js', () => ({
  getContentLocaleRouteConfig: () => ({ contentLocales: [], defaultContentLocale: 'en' }),
}))
vi.mock('../admin-shell/collections/edit.js', async () => {
  const { useEffect } = await import('react')
  return {
    EditView: ({ viewState }: { viewState?: EditorViewStateStore }) => {
      useEffect(() => {
        mocks.mounts += 1
      }, [])
      mocks.stores.push(viewState)
      return null
    },
  }
})

import { createCollectionEditRoute } from './create-collection-edit-route.js'

async function mountRouter(initial: string) {
  const rootRoute = createRootRoute()
  mocks.rootRoute = rootRoute
  const editRoute = createCollectionEditRoute('/admin/collections/$collection/$id')
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/collections/$collection',
    component: () => null,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([editRoute, listRoute]),
    history: createMemoryHistory({ initialEntries: [initial] }),
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    await router.load()
    root.render(<RouterProvider router={router} />)
  })
  const go = (to: string) =>
    act(async () => {
      await router.navigate({ to } as never)
      await vi.waitFor(() => expect(router.state.status).toBe('idle'))
    })
  const unmount = async () => {
    await act(async () => root.unmount())
    container.remove()
  }
  return { go, unmount }
}

const lastStore = () => mocks.stores[mocks.stores.length - 1]

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.mounts = 0
  mocks.stores = []
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('editor view-state visit', () => {
  it('the same store survives a save navigation and a locale change', async () => {
    const { go, unmount } = await mountRouter('/admin/collections/pages/doc-1?locale=en')
    try {
      const first = lastStore()
      expect(first).toBeDefined()
      expect(mocks.mounts).toBe(1)

      // Post-save navigation: same document, search params change.
      await go('/admin/collections/pages/doc-1?locale=en&action=created')
      expect(lastStore()).toBe(first)

      // Locale switch remounts the keyed EditView, but not the route component.
      await go('/admin/collections/pages/doc-1?locale=th')
      expect(mocks.mounts).toBe(2)
      expect(lastStore()).toBe(first)
    } finally {
      await unmount()
    }
  })

  it('changing the document id starts a new visit', async () => {
    const { go, unmount } = await mountRouter('/admin/collections/pages/doc-1?locale=en')
    try {
      const first = lastStore()
      await go('/admin/collections/pages/doc-2?locale=en')
      expect(lastStore()).toBeDefined()
      expect(lastStore()).not.toBe(first)
    } finally {
      await unmount()
    }
  })

  it('leaving to the list and reopening starts a new visit', async () => {
    const { go, unmount } = await mountRouter('/admin/collections/pages/doc-1?locale=en')
    try {
      const first = lastStore()
      await go('/admin/collections/pages')
      await go('/admin/collections/pages/doc-1?locale=en')
      expect(lastStore()).toBeDefined()
      expect(lastStore()).not.toBe(first)
    } finally {
      await unmount()
    }
  })
})
