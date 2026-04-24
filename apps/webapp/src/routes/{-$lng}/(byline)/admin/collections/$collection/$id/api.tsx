/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, notFound } from '@tanstack/react-router'

import type { CollectionDefinition } from '@byline/core'
import { getCollectionDefinition } from '@byline/core'
import { z } from 'zod'

import { getCollectionDocument } from '@/modules/admin/collections'
import { ApiView } from '@/modules/admin/collections/components/api'
import { BreadcrumbsClient } from '@/ui/breadcrumbs/breadcrumbs-client'
import { i18n } from '~/i18n'

const searchSchema = z.object({
  locale: z.string().optional(),
  /**
   * Populate depth for relation fields. Capped at 3 to avoid runaway
   * fan-out in the admin preview. Programmatic callers via
   * `@byline/client` can go deeper.
   */
  depth: z.coerce.number().int().min(0).max(3).optional(),
})

export const Route = createFileRoute('/{-$lng}/(byline)/admin/collections/$collection/$id/api')({
  validateSearch: searchSchema,
  loaderDeps: ({ search: { locale, depth } }) => ({ locale, depth }),
  loader: async ({ params, deps: { locale, depth } }) => {
    const collectionDef = getCollectionDefinition(params.collection)
    if (!collectionDef) {
      throw notFound()
    }

    // 'all' is now always explicit in the URL when the user picks it.
    // No locale param means the user hasn't made a selection yet — default
    // to the content default locale (same as History and Edit behaviours).
    const resolvedLocale = locale ?? i18n.content.defaultLocale
    const data = await getCollectionDocument(params.collection, params.id, resolvedLocale, depth)

    if (!data) {
      throw notFound()
    }

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
  const { locale, depth } = Route.useSearch()
  const collectionDef = getCollectionDefinition(collection) as CollectionDefinition

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
            label: 'API',
            href: `/admin/collections/${collection}/${id}/api`,
          },
        ]}
      />
      <ApiView
        collectionDefinition={collectionDef}
        initialData={data}
        locale={locale}
        depth={depth}
      />
    </>
  )
}
