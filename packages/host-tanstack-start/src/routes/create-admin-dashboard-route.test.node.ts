/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCollectionStats: vi.fn(),
  collections: [
    { path: 'articles', labels: { singular: 'Article', plural: 'Articles' }, showStats: true },
    {
      singleton: true,
      path: 'site-settings',
      label: 'Site settings',
      // Deliberately collection-like: kind must win even for malformed input.
      showStats: true,
    },
  ],
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
}))

vi.mock('@byline/core', () => ({
  filterReadableCollections: (collections: unknown[]) => collections,
  getAdminConfig: () => ({ collections: mocks.collections }),
  isSingleton: (definition: { singleton?: boolean }) => definition.singleton === true,
}))

vi.mock('../server-fns/collections/index.js', () => ({
  getCollectionStats: mocks.getCollectionStats,
}))
vi.mock('../admin-shell/chrome/breadcrumbs/breadcrumbs-client.js', () => ({
  BreadcrumbsClient: () => null,
}))
vi.mock('../admin-shell/chrome/dashboard.js', () => ({ AdminDashboard: () => null }))
vi.mock('@byline/i18n/react', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('./admin-path.js', () => ({ getAdminRoutePath: () => '/admin' }))

import { createAdminDashboardRoute } from './create-admin-dashboard-route.js'

type DashboardLoader = (input: {
  context: { user: { is_super_admin: boolean; abilities: string[] } }
}) => Promise<{ statsMap: Record<string, Array<{ status: string; count: number }>> }>

describe('admin dashboard route loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCollectionStats.mockResolvedValue([{ status: 'published', count: 4 }])
  })

  it('never requests collection statistics for a singleton resource', async () => {
    const route = createAdminDashboardRoute('/admin/') as {
      options: { loader: DashboardLoader }
    }

    await expect(
      route.options.loader({ context: { user: { is_super_admin: true, abilities: [] } } })
    ).resolves.toEqual({ statsMap: { articles: [{ status: 'published', count: 4 }] } })

    expect(mocks.getCollectionStats).toHaveBeenCalledOnce()
    expect(mocks.getCollectionStats).toHaveBeenCalledWith('articles')
    expect(mocks.getCollectionStats).not.toHaveBeenCalledWith('site-settings')
  })
})
