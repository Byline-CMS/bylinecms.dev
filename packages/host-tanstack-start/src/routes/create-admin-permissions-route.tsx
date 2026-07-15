/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute } from '@tanstack/react-router'

import { AbilitiesInspector } from '@byline/admin/admin-permissions/components/inspector'
import { useTranslation } from '@byline/i18n/react'

import { BreadcrumbsClient } from '../admin-shell/chrome/breadcrumbs/breadcrumbs-client.js'
import {
  type ListRegisteredAbilitiesResponse,
  listRegisteredAbilities,
} from '../server-fns/admin-permissions/index.js'
import { getAdminRoutePath } from './admin-path.js'

export function createAdminPermissionsRoute(path: string) {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic path bypasses route-tree typing
  const Route: any = createFileRoute(path as never)({
    loader: async () => {
      const data = await listRegisteredAbilities()
      return { data }
    },
    component: function AdminPermissionsComponent() {
      const { data } = Route.useLoaderData() as { data: ListRegisteredAbilitiesResponse }
      const { t } = useTranslation('byline-admin')
      return (
        <>
          <BreadcrumbsClient
            breadcrumbs={[
              { label: t('chrome.menu.dashboard'), href: getAdminRoutePath() },
              { label: t('chrome.menu.permissions'), href: getAdminRoutePath('permissions') },
            ]}
          />
          <AbilitiesInspector data={data} />
        </>
      )
    },
  })

  return Route
}
