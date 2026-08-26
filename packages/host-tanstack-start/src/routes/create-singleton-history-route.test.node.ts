/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSingletonHistory: vi.fn(),
  getSingleton: vi.fn(),
  definition: {
    singleton: true,
    path: 'site-settings',
    label: 'Site settings',
    fields: [],
  },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  notFound: () => new Error('not found'),
}))

vi.mock('@byline/core', () => ({
  getCollectionDefinition: (path: string) =>
    path === mocks.definition.path ? mocks.definition : null,
  isSingleton: (definition: { singleton?: boolean }) => definition.singleton === true,
  getSingletonAdminConfig: () => null,
  getWorkflowStatuses: () => [],
}))

vi.mock('../server-fns/singletons/index.js', () => ({
  getSingletonHistory: mocks.getSingletonHistory,
  getSingleton: mocks.getSingleton,
}))

vi.mock('../admin-shell/chrome/breadcrumbs/breadcrumbs-client.js', () => ({
  BreadcrumbsClient: () => null,
}))
vi.mock('../admin-shell/singletons/history.js', () => ({ SingletonHistoryView: () => null }))
vi.mock('@byline/i18n/react', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('./admin-path.js', () => ({ getAdminRoutePath: () => '/admin' }))
vi.mock('./get-content-locale-route-config.js', () => ({
  getContentLocaleRouteConfig: () => ({ contentLocales: [], defaultContentLocale: 'en' }),
}))

import { createSingletonHistoryRoute } from './create-singleton-history-route.js'

interface RouteLoaderInput {
  params: { singleton: string }
  deps: {
    page?: number
    page_size?: number
    order?: string
    desc?: boolean
    locale?: string
  }
}

type RouteLoader = (input: RouteLoaderInput) => Promise<unknown>

function loader(): RouteLoader {
  const route = createSingletonHistoryRoute('/admin/singletons/$singleton/history') as {
    options: { loader: RouteLoader }
  }
  return route.options.loader
}

describe('singleton history route loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSingleton.mockResolvedValue(null)
  })

  it('loads a paginated materialised singleton history without a document id input', async () => {
    const history = {
      docs: [{ id: 'document-settings', versionId: 'version-1', status: 'draft' }],
      meta: { total: 3, page: 2, pageSize: 1, totalPages: 3 },
      actors: {},
    }
    const currentDocument = {
      id: 'document-settings',
      versionId: 'version-3',
      status: 'draft',
      fields: {},
    }
    mocks.getSingletonHistory.mockResolvedValue(history)
    mocks.getSingleton.mockResolvedValue(currentDocument)

    await expect(
      loader()({
        params: { singleton: 'site-settings' },
        deps: { page: 2, page_size: 1, order: 'created_at', desc: true, locale: 'fr' },
      })
    ).resolves.toEqual({ history, currentDocument })

    expect(mocks.getSingletonHistory).toHaveBeenCalledWith({
      data: {
        singleton: 'site-settings',
        params: {
          page: 2,
          page_size: 1,
          order: 'created_at',
          desc: true,
          locale: 'fr',
        },
      },
    })
    expect(mocks.getSingleton).toHaveBeenCalledWith({
      data: { singleton: 'site-settings', locale: 'fr' },
    })
  })

  it('preserves the requested empty FindResult envelope for an unmaterialised slot', async () => {
    const history = {
      docs: [],
      meta: { total: 0, page: 4, pageSize: 30, totalPages: 0 },
      actors: {},
    }
    mocks.getSingletonHistory.mockResolvedValue(history)

    await expect(
      loader()({
        params: { singleton: 'site-settings' },
        deps: { page: 4, page_size: 30 },
      })
    ).resolves.toEqual({ history, currentDocument: null })

    expect(mocks.getSingleton).toHaveBeenCalledWith({
      data: { singleton: 'site-settings', locale: 'all' },
    })
  })

  it('preserves a kind-aware read denial from the singleton handle', async () => {
    const forbidden = {
      code: 'ERR_FORBIDDEN',
      details: { ability: 'singletons.site-settings.read' },
    }
    mocks.getSingletonHistory.mockRejectedValue(forbidden)

    await expect(loader()({ params: { singleton: 'site-settings' }, deps: {} })).rejects.toBe(
      forbidden
    )
  })
})
