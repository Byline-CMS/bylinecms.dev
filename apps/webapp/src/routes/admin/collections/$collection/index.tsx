/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
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
  action: z.enum(['created']).optional(),
})

export const Route = createFileRoute('/admin/collections/$collection/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search: { page, page_size, order, desc, query, locale } }) => ({
    page,
    page_size,
    order,
    desc,
    query,
    locale,
  }),
  loader: async ({ params, deps: { page, page_size, order, desc, query, locale } }) => {
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
          { label: data.included.collection.labels.plural, href: `/collections/${collection}` },
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
