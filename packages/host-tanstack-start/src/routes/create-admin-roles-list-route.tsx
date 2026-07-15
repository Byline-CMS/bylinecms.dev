/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute } from '@tanstack/react-router'

import { useTranslation } from '@byline/i18n/react'

import { AdminRolesListView } from '../admin-shell/admin-roles/list.js'
import { BreadcrumbsClient } from '../admin-shell/chrome/breadcrumbs/breadcrumbs-client.js'
import { type AdminRoleListResponse, listAdminRoles } from '../server-fns/admin-roles/index.js'
import { getAdminRoutePath } from './admin-path.js'

export function createAdminRolesListRoute(path: string) {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic path bypasses route-tree typing
  const Route: any = createFileRoute(path as never)({
    loader: async () => {
      const data = await listAdminRoles()
      return { data }
    },
    component: function AdminRolesListComponent() {
      const { data } = Route.useLoaderData() as { data: AdminRoleListResponse }
      const { t } = useTranslation('byline-admin')
      return (
        <>
          <BreadcrumbsClient
            breadcrumbs={[
              { label: t('chrome.menu.dashboard'), href: getAdminRoutePath() },
              { label: t('chrome.menu.adminRoles'), href: getAdminRoutePath('roles') },
            ]}
          />
          <AdminRolesListView data={data} />
        </>
      )
    },
  })

  return Route
}
