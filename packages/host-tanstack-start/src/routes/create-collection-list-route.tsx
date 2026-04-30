/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect, useRef } from 'react'
import { createFileRoute, notFound } from '@tanstack/react-router'

import type { CollectionDefinition } from '@byline/core'
import {
  getCollectionAdminConfig,
  getCollectionDefinition,
  getWorkflowStatuses,
} from '@byline/core'
import { useToastManager } from '@infonomic/uikit/react'
import { z } from 'zod'

import { BreadcrumbsClient } from '../admin-shell/chrome/breadcrumbs/breadcrumbs-client.js'
import { useNavigate } from '../admin-shell/chrome/loose-router.js'
import { ListView } from '../admin-shell/collections/list.js'
import { getCollectionDocuments } from '../server-fns/collections/index.js'

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

export function createCollectionListRoute(path: string) {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic path bypasses route-tree typing
  const Route: any = createFileRoute(path as never)({
    validateSearch: searchSchema,
    loaderDeps: ({ search }: { search: z.infer<typeof searchSchema> }) => ({
      page: search.page,
      page_size: search.page_size,
      order: search.order,
      desc: search.desc,
      query: search.query,
      locale: search.locale,
      status: search.status,
    }),
    loader: async ({
      params,
      deps,
    }: {
      params: { collection: string }
      deps: {
        page?: number
        page_size?: number
        order?: string
        desc?: boolean
        query?: string
        locale?: string
        status?: string
      }
    }) => {
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
            page: deps.page,
            page_size: deps.page_size,
            order: deps.order,
            desc: deps.desc,
            query: deps.query,
            locale: deps.locale,
            status: deps.status,
            fields,
          },
        },
      })

      return data
    },
    component: function CollectionListComponent() {
      const toastManager = useToastManager()
      const data = Route.useLoaderData()
      const { collection } = Route.useParams() as { collection: string }
      const search = Route.useSearch() as z.infer<typeof searchSchema>
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
          search: (prev: Record<string, unknown>) => ({ ...prev, action: undefined }),
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
    },
  })

  return Route
}
