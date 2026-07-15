/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute } from '@tanstack/react-router'

import { useTranslation } from '@byline/i18n/react'
import { z } from 'zod'

import { AdminUsersListView } from '../admin-shell/admin-users/list.js'
import { BreadcrumbsClient } from '../admin-shell/chrome/breadcrumbs/breadcrumbs-client.js'
import { type AdminUserListResponse, listAdminUsers } from '../server-fns/admin-users/index.js'
import { getAdminRoutePath } from './admin-path.js'

const orderSchema = z.enum([
  'given_name',
  'family_name',
  'email',
  'username',
  'created_at',
  'updated_at',
])

const searchSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
  query: z.string().optional(),
  order: orderSchema.optional(),
  desc: z.coerce.boolean().optional(),
})

export function createAdminUsersListRoute(path: string) {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic path bypasses route-tree typing
  const Route: any = createFileRoute(path as never)({
    validateSearch: searchSchema,
    loaderDeps: ({ search }: { search: z.infer<typeof searchSchema> }) => ({
      page: search.page,
      page_size: search.page_size,
      query: search.query,
      order: search.order,
      desc: search.desc,
    }),
    loader: async ({
      deps,
    }: {
      deps: {
        page?: number
        page_size?: number
        query?: string
        order?: string
        desc?: boolean
      }
    }) => {
      const data = await listAdminUsers({
        data: {
          page: deps.page,
          pageSize: deps.page_size,
          query: deps.query,
          order: deps.order as never,
          desc: deps.desc,
        },
      })
      return { data }
    },
    component: function AdminUsersListComponent() {
      const { data } = Route.useLoaderData() as { data: AdminUserListResponse }
      const { t } = useTranslation('byline-admin')
      return (
        <>
          <BreadcrumbsClient
            breadcrumbs={[
              { label: t('chrome.menu.dashboard'), href: getAdminRoutePath() },
              { label: t('chrome.menu.adminUsers'), href: getAdminRoutePath('users') },
            ]}
          />
          <AdminUsersListView data={data} />
        </>
      )
    },
  })

  return Route
}
