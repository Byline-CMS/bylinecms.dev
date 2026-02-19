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

import { createFileRoute, notFound } from '@tanstack/react-router'

import type { CollectionDefinition } from '@byline/core'
import { getCollectionAdminConfig, getCollectionDefinition } from '@byline/core'

import { BreadcrumbsClient } from '@/context/breadcrumbs/breadcrumbs-client'
import { EditView } from '@/modules/admin/collections/components/edit'
import { getCollectionDocument } from '@/modules/admin/collections/data'

export const Route = createFileRoute('/admin/collections/$collection/$id/')({
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
  const adminConfig = getCollectionAdminConfig(collection)

  return (
    <>
      <BreadcrumbsClient
        breadcrumbs={[
          { label: collectionDef.labels.plural, href: `/collections/${collection}` },
          {
            label: 'Edit',
            href: `/collections/${collection}/${id}`,
          },
        ]}
      />
      <EditView collectionDefinition={collectionDef} adminConfig={adminConfig ?? undefined} initialData={data} />
    </>
  )
}
