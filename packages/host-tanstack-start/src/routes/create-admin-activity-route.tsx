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

import { ActivitySystemView } from '../admin-shell/admin-activity/list.js'
import { BreadcrumbsClient } from '../admin-shell/chrome/breadcrumbs/breadcrumbs-client.js'
import { getSystemActivityLog } from '../server-fns/admin-activity/index.js'
import type { SystemActivityResponse } from '../server-fns/admin-activity/index.js'

const searchSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
  collection: z.string().optional(),
  action: z.string().optional(),
  actorId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
})

type ActivitySearch = z.infer<typeof searchSchema>

export function createAdminActivityRoute(path: string) {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic path bypasses route-tree typing
  const Route: any = createFileRoute(path as never)({
    validateSearch: searchSchema,
    loaderDeps: ({ search }: { search: ActivitySearch }) => ({
      page: search.page,
      page_size: search.page_size,
      collection: search.collection,
      action: search.action,
      actorId: search.actorId,
      from: search.from,
      to: search.to,
    }),
    loader: async ({ deps }: { deps: ActivitySearch }) => {
      const data = await getSystemActivityLog({
        data: {
          page: deps.page,
          page_size: deps.page_size,
          collection: deps.collection,
          action: deps.action,
          actorId: deps.actorId,
          from: deps.from,
          to: deps.to,
        },
      })
      return { data }
    },
    component: function AdminActivityComponent() {
      const { data } = Route.useLoaderData() as { data: SystemActivityResponse }
      const { t } = useTranslation('byline-admin')
      return (
        <>
          <BreadcrumbsClient
            breadcrumbs={[
              { label: t('chrome.menu.dashboard'), href: '/admin' },
              { label: t('activity.title'), href: '/admin/activity' },
            ]}
          />
          <ActivitySystemView data={data} />
        </>
      )
    },
  })

  return Route
}
