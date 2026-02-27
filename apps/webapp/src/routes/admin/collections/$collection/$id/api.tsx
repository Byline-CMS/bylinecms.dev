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

import { BreadcrumbsClient } from '@/context/breadcrumbs/breadcrumbs-client'
import { getCollectionDocument } from '@/modules/admin/collections'
import { ApiView } from '@/modules/admin/collections/components/api'

const searchSchema = z.object({
  locale: z.string().optional(),
})

export const Route = createFileRoute('/admin/collections/$collection/$id/api')({
  validateSearch: searchSchema,
  loaderDeps: ({ search: { locale } }) => ({ locale }),
  loader: async ({ params, deps: { locale } }) => {
    const collectionDef = getCollectionDefinition(params.collection)
    if (!collectionDef) {
      throw notFound()
    }

    // No locale or 'all' → pass 'all' explicitly so the storage layer returns
    // all locales (undefined would fall back to 'en' in the server fn).
    const resolvedLocale = locale ?? 'all'
    const data = await getCollectionDocument(params.collection, params.id, resolvedLocale)

    if (!data) {
      throw notFound()
    }

    console.log('Fetched data:', JSON.stringify(data, null, 2))

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
  const { locale } = Route.useSearch()
  const navigate = Route.useNavigate()
  const collectionDef = getCollectionDefinition(collection) as CollectionDefinition

  const handleLocaleChange = (newLocale: string) => {
    navigate({
      to: '/admin/collections/$collection/$id/api',
      params: { collection, id },
      search: { locale: newLocale === 'all' ? undefined : newLocale },
    })
  }

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
            label: 'API',
            href: `/admin/collections/${collection}/${id}/api`,
          },
        ]}
      />
      <ApiView
        collectionDefinition={collectionDef}
        initialData={data}
        locale={locale}
        onLocaleChange={handleLocaleChange}
      />
    </>
  )
}
