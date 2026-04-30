/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, notFound } from '@tanstack/react-router'

import type { CollectionDefinition } from '@byline/core'
import {
  getCollectionAdminConfig,
  getCollectionDefinition,
  getWorkflowStatuses,
} from '@byline/core'
import { z } from 'zod'

import { BreadcrumbsClient } from '../admin-shell/chrome/breadcrumbs/breadcrumbs-client.js'
import { HistoryView } from '../admin-shell/collections/history.js'
import {
  getCollectionDocument,
  getCollectionDocumentHistory,
} from '../server-fns/collections/index.js'
import type { ContentLocaleOption } from '../admin-shell/collections/view-menu.js'

const searchSchema = z.object({
  page: z.coerce.number().min(1).optional(),
  page_size: z.coerce.number().max(100).optional(),
  order: z.string().optional(),
  desc: z.coerce.boolean().optional(),
  locale: z.string().optional(),
})

interface CollectionHistoryOpts {
  contentLocales: ReadonlyArray<ContentLocaleOption>
  defaultContentLocale: string
}

export function createCollectionHistoryRoute(path: string, opts: CollectionHistoryOpts) {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic path bypasses route-tree typing
  const Route: any = createFileRoute(path as never)({
    validateSearch: searchSchema,
    loaderDeps: ({ search }: { search: z.infer<typeof searchSchema> }) => ({
      page: search.page,
      page_size: search.page_size,
      order: search.order,
      desc: search.desc,
      locale: search.locale,
    }),
    loader: async ({
      params,
      deps,
    }: {
      params: { collection: string; id: string }
      deps: {
        page?: number
        page_size?: number
        order?: string
        desc?: boolean
        locale?: string
      }
    }) => {
      const collectionDef = getCollectionDefinition(params.collection)
      if (!collectionDef) {
        throw notFound()
      }

      const [history, currentDocument] = await Promise.all([
        getCollectionDocumentHistory({
          data: {
            collection: params.collection,
            id: params.id,
            params: {
              page: deps.page,
              page_size: deps.page_size,
              order: deps.order,
              desc: deps.desc,
              locale: deps.locale,
            },
          },
        }),
        // Fetch the current document with the same locale (or 'all') so diffs
        // compare the same shape as what the user is viewing.
        getCollectionDocument(params.collection, params.id, deps.locale ?? 'all'),
      ])

      return { history, currentDocument }
    },
    staleTime: 0,
    gcTime: 0,
    shouldReload: true,
    component: function CollectionHistoryComponent() {
      const { history, currentDocument } = Route.useLoaderData()
      const { collection } = Route.useParams() as { collection: string; id: string }
      const collectionDef = getCollectionDefinition(collection) as CollectionDefinition
      const adminConfig = getCollectionAdminConfig(collection)

      return (
        <>
          <BreadcrumbsClient
            breadcrumbs={[
              { label: 'Dashboard', href: `/admin` },
              { label: collectionDef.labels.plural, href: `/admin/collections/${collection}` },
              {
                label: 'Edit',
                href: `/admin/collections/${collection}/${Route.useParams().id}`,
              },
              {
                label: 'History',
                href: `/admin/collections/${collection}/${Route.useParams().id}/history`,
              },
            ]}
          />
          <HistoryView
            collectionDefinition={collectionDef}
            workflowStatuses={getWorkflowStatuses(collectionDef)}
            adminConfig={adminConfig ?? undefined}
            data={history}
            currentDocument={currentDocument as Record<string, unknown> | null}
            contentLocales={opts.contentLocales}
            defaultContentLocale={opts.defaultContentLocale}
          />
        </>
      )
    },
  })

  return Route
}
