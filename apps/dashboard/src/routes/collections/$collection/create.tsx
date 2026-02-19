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
import { buildInitialDataFromFields, getCollectionAdminConfig, getCollectionDefinition } from '@byline/core'

import { BreadcrumbsClient } from '@/context/breadcrumbs/breadcrumbs-client'
import { CreateView } from '@/modules/collections/components/create'

export const Route = createFileRoute('/collections/$collection/create')({
  loader: async ({
    params,
  }): Promise<{ collectionDef: CollectionDefinition; initialData: any }> => {
    const collectionDef = getCollectionDefinition(params.collection)
    if (!collectionDef) {
      throw notFound()
    }
    const initialData = await buildInitialDataFromFields(collectionDef.fields, {
      data: {},
      now: () => new Date(),
    })
    return { collectionDef, initialData }
  },
  component: RouteComponent,
})

function RouteComponent() {
  const { collection } = Route.useParams()
  const { collectionDef, initialData } = Route.useLoaderData()
  const adminConfig = getCollectionAdminConfig(collection)
  return (
    <>
      <BreadcrumbsClient
        breadcrumbs={[
          { label: collectionDef.labels.plural, href: `/collections/${collection}` },
          { label: 'Create', href: `/collections/${collection}/create` },
        ]}
      />
      <CreateView collectionDefinition={collectionDef} adminConfig={adminConfig ?? undefined} initialData={initialData} />
    </>
  )
}
