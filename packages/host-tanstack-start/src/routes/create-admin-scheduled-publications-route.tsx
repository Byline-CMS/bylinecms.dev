/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, notFound } from '@tanstack/react-router'

import { useTranslation } from '@byline/i18n/react'
import { z } from 'zod'

import { BreadcrumbsClient } from '../admin-shell/chrome/breadcrumbs/breadcrumbs-client.js'
import { ScheduledPublicationsView } from '../admin-shell/scheduled-publications/list.js'
import {
  getScheduledPublicationRuntime,
  listScheduledPublications,
} from '../server-fns/collections/index.js'
import { getAdminRoutePath } from './admin-path.js'
import type { ScheduledPublicationListResponse } from '../server-fns/collections/index.js'

const searchSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
  state: z.enum(['armed', 'needs_reconfirm']).optional(),
  lastAuthorizedBy: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    .optional(),
})

type ScheduledPublicationsSearch = z.infer<typeof searchSchema>

export function createAdminScheduledPublicationsRoute(path: string) {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic path bypasses route-tree typing
  const Route: any = createFileRoute(path as never)({
    shouldReload: true,
    validateSearch: searchSchema,
    loaderDeps: ({ search }: { search: ScheduledPublicationsSearch }) => search,
    loader: async ({ deps }: { deps: ScheduledPublicationsSearch }) => {
      const runtime = await getScheduledPublicationRuntime()
      if (!runtime.enabled) throw notFound()
      const data = await listScheduledPublications({
        data: {
          page: deps.page,
          pageSize: deps.page_size,
          states: deps.state == null ? undefined : [deps.state],
          lastAuthorizedBy: deps.lastAuthorizedBy,
        },
      })
      return { data }
    },
    component: function AdminScheduledPublicationsComponent() {
      const { data } = Route.useLoaderData() as { data: ScheduledPublicationListResponse }
      const { t } = useTranslation('byline-admin')
      return (
        <>
          <BreadcrumbsClient
            breadcrumbs={[
              { label: t('chrome.menu.dashboard'), href: getAdminRoutePath() },
              {
                label: t('scheduledPublication.list.title'),
                href: getAdminRoutePath('scheduled-publications'),
              },
            ]}
          />
          <ScheduledPublicationsView data={data} />
        </>
      )
    },
  })

  return Route
}
