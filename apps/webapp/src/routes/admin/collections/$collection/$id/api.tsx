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

import { BreadcrumbsClient } from '@/context/breadcrumbs/breadcrumbs-client'
import { ApiView } from '@/modules/admin/collections/components/api'
import { getCollectionDocument } from '@/modules/admin/collections/data'

export const Route = createFileRoute('/admin/collections/$collection/$id/api')({
  loader: async ({ params }) => {
    const collectionDef = getCollectionDefinition(params.collection)
    if (!collectionDef) {
      throw notFound()
    }

    const data = await getCollectionDocument(params.collection, params.id)

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
  const collectionDef = getCollectionDefinition(collection) as CollectionDefinition

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
      <ApiView collectionDefinition={collectionDef} initialData={data} />
    </>
  )
}
