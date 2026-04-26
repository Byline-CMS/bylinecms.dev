/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute } from '@tanstack/react-router'

import { Container, Section } from '@infonomic/uikit/react'
import { z } from 'zod'

import { listAdminUsers } from '@/modules/admin/admin-users'
import { AdminUsersListView } from '@/modules/admin/admin-users/components/list'
import { BreadcrumbsClient } from '@/ui/breadcrumbs/breadcrumbs-client'

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

export const Route = createFileRoute('/{-$lng}/(byline)/admin/users/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search: { page, page_size, query, order, desc } }) => ({
    page,
    page_size,
    query,
    order,
    desc,
  }),
  loader: async ({ deps }) => {
    const data = await listAdminUsers({
      data: {
        page: deps.page,
        pageSize: deps.page_size,
        query: deps.query,
        order: deps.order,
        desc: deps.desc,
      },
    })
    return { data }
  },
  component: AdminUsersIndex,
})

function AdminUsersIndex() {
  const { data } = Route.useLoaderData()
  return (
    <>
      <BreadcrumbsClient
        breadcrumbs={[
          { label: 'Dashboard', href: '/admin' },
          { label: 'Admin Users', href: '/admin/users' },
        ]}
      />
      <AdminUsersListView data={data} />
    </>
  )
}
