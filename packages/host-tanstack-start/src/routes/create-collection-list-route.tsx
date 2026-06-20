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
import { useTranslation } from '@byline/i18n/react'
import { useToastManager } from '@byline/ui/react'
import { z } from 'zod'

import { BreadcrumbsClient } from '../admin-shell/chrome/breadcrumbs/breadcrumbs-client.js'
import { useNavigate } from '../admin-shell/chrome/loose-router.js'
import { ListView } from '../admin-shell/collections/list.js'
import { TreeListView } from '../admin-shell/collections/tree-list.js'
import {
  getCollectionDocuments,
  getCollectionTree,
  placeTreeNode,
  reorderCollectionDocument,
} from '../server-fns/collections/index.js'
import type { CollectionTreeRow } from '../server-fns/collections/tree.js'

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

      // `tree: true` collections use the built-in tree list view: load the whole
      // tree (ordered, depth-tagged rows + unplaced docs) rather than a
      // paginated single-collection page.
      if (collectionDef.tree === true) {
        return await getCollectionTree({
          data: { collection: params.collection, locale: deps.locale },
        })
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
      const { t } = useTranslation('byline-admin')
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
          title: t('collections.list.createdToastTitle', { label: collectionDef.labels.singular }),
          description: t('collections.list.createdToastDescription', {
            label: collectionDef.labels.singular.toLowerCase(),
          }),
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
      }, [search.action, navigate, toastManager.add, collectionDef.labels.singular, t])

      const CustomListView = adminConfig?.listView

      return (
        <>
          <BreadcrumbsClient
            breadcrumbs={[
              { label: t('chrome.menu.dashboard'), href: `/admin` },
              {
                label: data.included.collection.labels.plural,
                href: `/admin/collections/${collection}`,
              },
            ]}
          />
          {collectionDef.tree === true ? (
            <TreeListView
              rows={(data as { rows: CollectionTreeRow[] }).rows}
              columns={columns}
              workflowStatuses={workflowStatuses}
              useAsTitle={collectionDef.useAsTitle}
              collection={collection}
              collectionLabels={data.included.collection.labels}
              onMove={async ({
                documentId,
                parentDocumentId,
                beforeDocumentId,
                afterDocumentId,
              }) => {
                await placeTreeNode({
                  data: {
                    collection,
                    documentId,
                    parentDocumentId,
                    beforeDocumentId,
                    afterDocumentId,
                  },
                })
              }}
            />
          ) : CustomListView ? (
            <CustomListView data={data} workflowStatuses={workflowStatuses} />
          ) : (
            <ListView
              data={data}
              columns={columns}
              workflowStatuses={workflowStatuses}
              useAsTitle={collectionDef.useAsTitle}
              orderable={collectionDef.orderable === true}
              onReorder={async ({ documentId, beforeDocumentId, afterDocumentId }) => {
                await reorderCollectionDocument({
                  data: {
                    collection,
                    documentId,
                    beforeDocumentId,
                    afterDocumentId,
                  },
                })
              }}
            />
          )}
        </>
      )
    },
  })

  return Route
}
