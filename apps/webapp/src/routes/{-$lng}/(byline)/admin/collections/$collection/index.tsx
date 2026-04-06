/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect } from 'react'
import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'

import type { CollectionDefinition } from '@byline/core'
import {
  getCollectionAdminConfig,
  getCollectionDefinition,
  getWorkflowStatuses,
} from '@byline/core'
import { useToastManager } from '@infonomic/uikit/react'
import { z } from 'zod'

import { BreadcrumbsClient } from '@/context/breadcrumbs/breadcrumbs-client'
import { getCollectionDocuments } from '@/modules/admin/collections'
import { ListView } from '@/modules/admin/collections/components/list'

const searchSchema = z.object({
  page: z.coerce.number().min(1).optional(),
  page_size: z.coerce.number().max(100).optional(),
  order: z.string().optional(),
  desc: z.coerce.boolean().optional(),
  query: z.string().optional(),
  locale: z.string().optional(),
  status: z.string().optional(),
  action: z.enum(['created']).optional(),
})

export const Route = createFileRoute('/{-$lng}/(byline)/admin/collections/$collection/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search: { page, page_size, order, desc, query, locale, status } }) => ({
    page,
    page_size,
    order,
    desc,
    query,
    locale,
    status,
  }),
  loader: async ({ params, deps: { page, page_size, order, desc, query, locale, status } }) => {
    const collectionDef = getCollectionDefinition(params.collection)
    if (!collectionDef) {
      throw notFound()
    }

    const data = await getCollectionDocuments({
      data: {
        collection: params.collection,
        params: {
          page,
          page_size,
          order,
          desc,
          query,
          locale,
          status,
        },
      },
    })

    return data
  },
  component: RouteComponent,
})

function RouteComponent() {
  const toastManager = useToastManager()
  const data = Route.useLoaderData()
  const { collection } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const collectionDef = getCollectionDefinition(collection) as CollectionDefinition
  const adminConfig = getCollectionAdminConfig(collection)
  const columns = adminConfig?.columns || []
  const workflowStatuses = getWorkflowStatuses(collectionDef)

  useEffect(() => {
    if (search.action === 'created') {
      toastManager.add({
        title: `${collectionDef.labels.singular} Created`,
        description: `Successfully created ${collectionDef.labels.singular.toLowerCase()}`,
        data: {
          intent: 'success',
          iconType: 'success',
          icon: true,
          close: true,
        },
      })
      navigate({
        to: '.',
        search: (prev) => ({ ...prev, action: undefined }),
        replace: true,
      })
    }
  }, [search.action, navigate, toastManager, collectionDef.labels.singular])

  const CustomListView = adminConfig?.listView

  return (
    <>
      <BreadcrumbsClient
        breadcrumbs={[
          { label: 'Dashboard', href: `/admin` },
          {
            label: data.included.collection.labels.plural,
            href: `/admin/collections/${collection}`,
          },
        ]}
      />
      {CustomListView ? (
        <CustomListView data={data} workflowStatuses={workflowStatuses} />
      ) : (
        <ListView data={data} columns={columns} workflowStatuses={workflowStatuses} />
      )}
    </>
  )
}
