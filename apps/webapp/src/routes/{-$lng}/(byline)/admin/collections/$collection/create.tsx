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
  buildInitialDataFromFields,
  getCollectionAdminConfig,
  getCollectionDefinition,
} from '@byline/core'

import { BreadcrumbsClient } from '@/context/breadcrumbs/breadcrumbs-client'
import { CreateView } from '@/modules/admin/collections/components/create'

export const Route = createFileRoute('/{-$lng}/(byline)/admin/collections/$collection/create')({
  loader: async ({ params }): Promise<{ initialData: any }> => {
    const collectionDef = getCollectionDefinition(params.collection)
    if (!collectionDef) {
      throw notFound()
    }
    const initialData = await buildInitialDataFromFields(collectionDef.fields, {
      data: {},
      now: () => new Date(),
    })
    return { initialData }
  },
  component: RouteComponent,
})

function RouteComponent() {
  const { collection } = Route.useParams()
  const { initialData } = Route.useLoaderData()
  const collectionDef = getCollectionDefinition(collection) as CollectionDefinition
  const adminConfig = getCollectionAdminConfig(collection)
  return (
    <>
      <BreadcrumbsClient
        breadcrumbs={[
          { label: 'Admin', href: `/admin` },
          { label: collectionDef.labels.plural, href: `/admin/collections/${collection}` },
          { label: 'Create', href: `/admin/collections/${collection}/create` },
        ]}
      />
      <CreateView
        collectionDefinition={collectionDef}
        adminConfig={adminConfig ?? undefined}
        initialData={initialData}
      />
    </>
  )
}
