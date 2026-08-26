/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute } from '@tanstack/react-router'

import {
  filterReadableCollections,
  getAdminConfig,
  isSingleton,
  type MultiCollectionDefinition,
} from '@byline/core'
import { useTranslation } from '@byline/i18n/react'

import { BreadcrumbsClient } from '../admin-shell/chrome/breadcrumbs/breadcrumbs-client.js'
import { AdminDashboard } from '../admin-shell/chrome/dashboard.js'
import { type CollectionStatusCount, getCollectionStats } from '../server-fns/collections/index.js'
import { getAdminRoutePath } from './admin-path.js'

export function createAdminDashboardRoute(path: string) {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic path bypasses route-tree typing
  const Route: any = createFileRoute(path as never)({
    loader: async ({
      context,
    }: {
      context: { user: { is_super_admin: boolean; abilities: string[] } }
    }) => {
      const { collections } = getAdminConfig()

      // Only fetch counts for collections this administrator can read. Without
      // the filter, `getCollectionStats` fires for every collection and the
      // ones it cannot read throw inside `countByStatus`, get swallowed, and
      // land as an empty array — rendering every status tile as zero, which is
      // indistinguishable from a genuinely empty collection.
      const visible = filterReadableCollections(collections, {
        isSuperAdmin: context.user.is_super_admin,
        abilities: context.user.abilities,
      })

      const statsMap: Record<string, CollectionStatusCount[]> = {}

      await Promise.all(
        visible
          .filter(
            (resource): resource is MultiCollectionDefinition =>
              !isSingleton(resource) && resource.showStats === true
          )
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
      const { t } = useTranslation('byline-admin')
      return (
        <>
          <BreadcrumbsClient
            breadcrumbs={[{ label: t('chrome.menu.dashboard'), href: getAdminRoutePath() }]}
          />
          <AdminDashboard statsMap={statsMap} />
        </>
      )
    },
  })

  return Route
}
