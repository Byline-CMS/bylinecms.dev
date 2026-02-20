/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, notFound } from '@tanstack/react-router'

import type { CollectionDefinition } from '@byline/core'
import { getCollectionAdminConfig, getCollectionDefinition } from '@byline/core'
import { z } from 'zod'

import { BreadcrumbsClient } from '@/context/breadcrumbs/breadcrumbs-client'
import { HistoryView } from '@/modules/admin/collections/components/history'
import { getCollectionDocumentHistory } from '@/modules/admin/collections/data'

const searchSchema = z.object({
  page: z.coerce.number().min(1).optional(),
  page_size: z.coerce.number().max(100).optional(),
  order: z.string().optional(),
  desc: z.coerce.boolean().optional(),
  locale: z.string().optional(),
})

export const Route = createFileRoute('/admin/collections/$collection/$id/history')({
  validateSearch: searchSchema,
  loaderDeps: ({ search: { page, page_size, order, desc, locale } }) => ({
    page,
    page_size,
    order,
    desc,
    locale,
  }),
  loader: async ({ params, deps: { page, page_size, order, desc, locale } }) => {
    const collectionDef = getCollectionDefinition(params.collection)
    if (!collectionDef) {
      throw notFound()
    }

    const data = await getCollectionDocumentHistory(params.collection, params.id, {
      page,
      page_size,
      order,
      desc,
      locale,
    })

    return data
  },
  staleTime: 0,
  gcTime: 0,
  shouldReload: true,
  component: RouteComponent,
})

function RouteComponent() {
  const data = Route.useLoaderData()
  const { collection, id } = Route.useParams()
  const collectionDef = getCollectionDefinition(collection) as CollectionDefinition
  const adminConfig = getCollectionAdminConfig(collection)

  return (
    <>
      <BreadcrumbsClient
        breadcrumbs={[
          { label: 'Admin', href: `/admin` },
          { label: collectionDef.labels.plural, href: `/admin/collections/${collection}` },
          {
            label: 'Edit',
            href: `/admin/collections/${collection}/${id}`,
          },
          {
            label: 'History',
            href: `/admin/collections/${collection}/${id}/history`,
          },
        ]}
      />
      <HistoryView collectionDefinition={collectionDef} adminConfig={adminConfig ?? undefined} data={data} />
    </>
  )
}
