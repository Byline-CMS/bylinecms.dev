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
import { useTranslation } from '@byline/i18n/react'
import { z } from 'zod'

import { BreadcrumbsClient } from '../admin-shell/chrome/breadcrumbs/breadcrumbs-client.js'
import { CreateView } from '../admin-shell/collections/create.js'
import { getAdminRoutePath } from './admin-path.js'

const searchSchema = z.object({
  /** URL-encoded list search state to return to on cancel — see list-return-state.ts. */
  from: z.string().optional(),
})

export function createCollectionCreateRoute(path: string) {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic path bypasses route-tree typing
  const Route: any = createFileRoute(path as never)({
    validateSearch: searchSchema,
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
      const { t } = useTranslation('byline-admin')
      const search = Route.useSearch() as z.infer<typeof searchSchema>
      return (
        <>
          <BreadcrumbsClient
            breadcrumbs={[
              { label: t('chrome.menu.dashboard'), href: getAdminRoutePath() },
              {
                label: collectionDef.labels.plural,
                href: getAdminRoutePath('collections', collection),
              },
              {
                label: t('collections.breadcrumbs.create'),
                href: getAdminRoutePath('collections', collection, 'create'),
              },
            ]}
          />
          <CreateView
            collectionDefinition={collectionDef}
            adminConfig={adminConfig ?? undefined}
            initialData={initialData}
            from={search.from}
          />
        </>
      )
    },
  })

  return Route
}
