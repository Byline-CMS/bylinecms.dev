/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect, useRef } from 'react'
import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'

import type { CollectionDefinition } from '@byline/core'
import {
  getCollectionAdminConfig,
  getCollectionDefinition,
  getWorkflowStatuses,
} from '@byline/core'
import { getCollectionDocuments } from '@byline/host-tanstack-start/server-fns/collections'
import { useToastManager } from '@infonomic/uikit/react'
import { z } from 'zod'

import { ListView } from '@/modules/admin/collections/ui/list'
import { BreadcrumbsClient } from '@/ui/breadcrumbs/breadcrumbs-client'

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

export const Route = createFileRoute('/(byline)/admin/collections/$collection/')({
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

    // Derive the field names the list view needs from the admin column config.
    // This lets findDocuments query only the relevant store tables.
    const adminConfig = getCollectionAdminConfig(params.collection)
    const fields = adminConfig?.columns
      ?.map((c) => String(c.fieldName))
      .filter((name) => collectionDef.fields.some((f) => f.name === name))

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
          fields,
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

  // Ref-guarded so the post-create toast fires exactly once per arrival with
  // ?action=created. Base UI's useToastManager returns a new memoized object
  // whenever its internal toasts array changes — depending on `toastManager`
  // (the object) in the deps array would create a loop: add() updates toasts
  // → new toastManager identity → effect re-fires → add again. We depend on
  // `toastManager.add` (the underlying store method, which is stable), and
  // the ref is belt-and-suspenders protection against any re-fire that
  // observes `search.action === 'created'` before navigate clears it.
  const createdToastFiredRef = useRef(false)
  useEffect(() => {
    if (search.action !== 'created') {
      createdToastFiredRef.current = false
      return
    }
    if (createdToastFiredRef.current) return
    createdToastFiredRef.current = true

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
  }, [
    search.action,
    navigate,
    toastManager.add,
    collectionDef.labels.singular.toLowerCase,
    collectionDef.labels.singular,
  ])

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
        <ListView
          data={data}
          columns={columns}
          workflowStatuses={workflowStatuses}
          useAsTitle={collectionDef.useAsTitle}
        />
      )}
    </>
  )
}
