/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect, useState } from 'react'
import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'

import type { CollectionDefinition } from '@byline/core'
import { getCollectionAdminConfig, getCollectionDefinition } from '@byline/core'
import { Toast } from '@infonomic/uikit/react'
import { z } from 'zod'

import { BreadcrumbsClient } from '@/context/breadcrumbs/breadcrumbs-client'
import { ListView } from '@/modules/admin/collections/components/list'
import { getCollectionDocuments } from '@/modules/admin/collections/data'

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

export const Route = createFileRoute('/admin/collections/$collection/')({
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

    const data = await getCollectionDocuments(params.collection, {
      page,
      page_size,
      order,
      desc,
      query,
      locale,
      status,
    })

    return data
  },
  component: RouteComponent,
})

function RouteComponent() {
  const data = Route.useLoaderData()
  const { collection } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const collectionDef = getCollectionDefinition(collection) as CollectionDefinition
  const adminConfig = getCollectionAdminConfig(collection)
  const columns = adminConfig?.columns || []
  const [toastOpen, setToastOpen] = useState(false)

  useEffect(() => {
    if (search.action === 'created') {
      setToastOpen(true)
      navigate({
        to: '.',
        search: (prev) => ({ ...prev, action: undefined }),
        replace: true,
      })
    }
  }, [search.action, navigate])

  return (
    <>
      <BreadcrumbsClient
        breadcrumbs={[
          { label: 'Admin', href: `/admin` },
          { label: data.included.collection.labels.plural, href: `/admin/collections/${collection}` },
        ]}
      />
      <ListView data={data} columns={columns} />
      <Toast
        title={`${collectionDef.labels.singular} Created`}
        intent="success"
        message={`Successfully created ${collectionDef.labels.singular.toLowerCase()}`}
        open={toastOpen}
        onOpenChange={setToastOpen}
        position="bottom-right"
      />
    </>
  )
}
