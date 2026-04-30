/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute } from '@tanstack/react-router'

import { AbilitiesInspector } from '@byline/ui'

import { listRegisteredAbilities } from '@/modules/admin/admin-permissions'
import { BreadcrumbsClient } from '@/ui/breadcrumbs/breadcrumbs-client'

export const Route = createFileRoute('/(byline)/admin/permissions/')({
  loader: async () => {
    const data = await listRegisteredAbilities()
    return { data }
  },
  component: AdminPermissionsIndex,
})

function AdminPermissionsIndex() {
  const { data } = Route.useLoaderData()
  return (
    <>
      <BreadcrumbsClient
        breadcrumbs={[
          { label: 'Dashboard', href: '/admin' },
          { label: 'Permissions', href: '/admin/permissions' },
        ]}
      />
      <AbilitiesInspector data={data} />
    </>
  )
}
