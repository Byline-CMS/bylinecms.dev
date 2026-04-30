/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute } from '@tanstack/react-router'

import { getClientConfig } from '@byline/core'

import { BreadcrumbsClient } from '../admin-shell/chrome/breadcrumbs/breadcrumbs-client.js'
import { AdminDashboard } from '../admin-shell/chrome/dashboard.js'
import { type CollectionStatusCount, getCollectionStats } from '../server-fns/collections/index.js'

export function createAdminDashboardRoute(path: string) {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic path bypasses route-tree typing
  const Route: any = createFileRoute(path as never)({
    loader: async () => {
      const { collections } = getClientConfig()
      const statsMap: Record<string, CollectionStatusCount[]> = {}

      await Promise.all(
        collections
          .filter((c) => c.showStats === true)
          .map(async (c) => {
            try {
              statsMap[c.path] = await getCollectionStats(c.path)
            } catch {
              statsMap[c.path] = []
            }
          })
      )

      return { statsMap }
    },
    component: function AdminDashboardComponent() {
      const { statsMap } = Route.useLoaderData() as {
        statsMap: Record<string, CollectionStatusCount[]>
      }
      return (
        <>
          <BreadcrumbsClient breadcrumbs={[{ label: 'Dashboard', href: '/admin' }]} />
          <AdminDashboard statsMap={statsMap} />
        </>
      )
    },
  })

  return Route
}
