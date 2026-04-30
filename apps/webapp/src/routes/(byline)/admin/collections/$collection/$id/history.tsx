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
import { BreadcrumbsClient } from '@byline/host-tanstack-start/admin-shell/chrome/breadcrumbs/breadcrumbs-client'
import { HistoryView } from '@byline/host-tanstack-start/admin-shell/collections/history'
import {
  getCollectionDocument,
  getCollectionDocumentHistory,
} from '@byline/host-tanstack-start/server-fns/collections'
import { z } from 'zod'

import { contentLocales, i18n } from '~/i18n'

const searchSchema = z.object({
  page: z.coerce.number().min(1).optional(),
  page_size: z.coerce.number().max(100).optional(),
  order: z.string().optional(),
  desc: z.coerce.boolean().optional(),
  locale: z.string().optional(),
})

export const Route = createFileRoute('/(byline)/admin/collections/$collection/$id/history')({
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

    const [history, currentDocument] = await Promise.all([
      getCollectionDocumentHistory({
        data: {
          collection: params.collection,
          id: params.id,
          params: {
            page,
            page_size,
            order,
            desc,
            locale,
          },
        },
      }),
      // Fetch the current document with the same locale (or 'all') so diffs
      // compare the same shape as what the user is viewing.
      getCollectionDocument(params.collection, params.id, locale ?? 'all'),
    ])

    return { history, currentDocument }
  },
  staleTime: 0,
  gcTime: 0,
  shouldReload: true,
  component: RouteComponent,
})

function RouteComponent() {
  const { history, currentDocument } = Route.useLoaderData()
  const { collection, id } = Route.useParams()
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
            href: `/admin/collections/${collection}/${id}`,
          },
          {
            label: 'History',
            href: `/admin/collections/${collection}/${id}/history`,
          },
        ]}
      />
      <HistoryView
        collectionDefinition={collectionDef}
        workflowStatuses={getWorkflowStatuses(collectionDef)}
        adminConfig={adminConfig ?? undefined}
        data={history}
        currentDocument={currentDocument as Record<string, unknown> | null}
        contentLocales={contentLocales}
        defaultContentLocale={i18n.content.defaultLocale}
      />
    </>
  )
}
