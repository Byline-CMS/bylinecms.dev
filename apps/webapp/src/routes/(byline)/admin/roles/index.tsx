/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute } from '@tanstack/react-router'

import { listAdminRoles } from '@byline/host-tanstack-start/server-fns/admin-roles'

import { AdminRolesListView } from '@/modules/admin/admin-roles/ui/list'
import { BreadcrumbsClient } from '@/ui/breadcrumbs/breadcrumbs-client'

export const Route = createFileRoute('/(byline)/admin/roles/')({
  loader: async () => {
    const data = await listAdminRoles()
    return { data }
  },
  component: AdminRolesIndex,
})

function AdminRolesIndex() {
  const { data } = Route.useLoaderData()
  return (
    <>
      <BreadcrumbsClient
        breadcrumbs={[
          { label: 'Dashboard', href: '/admin' },
          { label: 'Admin Roles', href: '/admin/roles' },
        ]}
      />
      <AdminRolesListView data={data} />
    </>
  )
}
