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

import { BreadcrumbsClient } from '../admin-shell/chrome/breadcrumbs/breadcrumbs-client.js'
import { CreateView } from '../admin-shell/collections/create.js'

export function createCollectionCreateRoute(path: string) {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic path bypasses route-tree typing
  const Route: any = createFileRoute(path as never)({
    loader: async ({
      params,
    }: {
      params: { collection: string }
      // biome-ignore lint/suspicious/noExplicitAny: collection-specific shape
    }): Promise<{ initialData: any }> => {
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
    component: function CollectionCreateComponent() {
      const { collection } = Route.useParams() as { collection: string }
      // biome-ignore lint/suspicious/noExplicitAny: collection-specific shape
      const { initialData } = Route.useLoaderData() as { initialData: any }
      const collectionDef = getCollectionDefinition(collection) as CollectionDefinition
      const adminConfig = getCollectionAdminConfig(collection)
      return (
        <>
          <BreadcrumbsClient
            breadcrumbs={[
              { label: 'Dashboard', href: '/admin' },
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
    },
  })

  return Route
}
