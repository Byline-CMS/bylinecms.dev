/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, notFound } from '@tanstack/react-router'

import type { CollectionDefinition } from '@byline/core'
import { getCollectionAdminConfig, getCollectionDefinition } from '@byline/core'
import { z } from 'zod'

import { BreadcrumbsClient } from '../admin-shell/chrome/breadcrumbs/breadcrumbs-client.js'
import { EditView } from '../admin-shell/collections/edit.js'
import { getCollectionDocument } from '../server-fns/collections/index.js'
import type { ContentLocaleOption } from '../admin-shell/collections/view-menu.js'

const searchSchema = z.object({
  locale: z.string().optional(),
})

interface CollectionEditOpts {
  contentLocales: ReadonlyArray<ContentLocaleOption>
  defaultContentLocale: string
}

export function createCollectionEditRoute(path: string, opts: CollectionEditOpts) {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic path bypasses route-tree typing
  const Route: any = createFileRoute(path as never)({
    validateSearch: searchSchema,
    loaderDeps: ({ search }: { search: z.infer<typeof searchSchema> }) => ({
      locale: search.locale,
    }),
    loader: async ({
      params,
      deps,
    }: {
      params: { collection: string; id: string }
      deps: { locale?: string }
    }) => {
      const collectionDef = getCollectionDefinition(params.collection)
      if (!collectionDef) {
        throw notFound()
      }

      // Auto-populate direct relation fields (depth 1) so the edit form's
      // relation-summary tiles render with target data (category name, media
      // thumbnail, etc.) on first paint. Projection is derived from each
      // target's `CollectionAdminConfig.picker` columns.
      const data = await getCollectionDocument(
        params.collection,
        params.id,
        deps.locale,
        undefined,
        true
      )

      if (!data) {
        throw notFound()
      }

      return data
    },
    staleTime: 0,
    gcTime: 0,
    shouldReload: true,
    component: function CollectionEditComponent() {
      const data = Route.useLoaderData()
      const { collection, id } = Route.useParams() as { collection: string; id: string }
      const { locale } = Route.useSearch() as z.infer<typeof searchSchema>
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
            ]}
          />
          <EditView
            collectionDefinition={collectionDef}
            adminConfig={adminConfig ?? undefined}
            initialData={data}
            locale={locale}
            contentLocales={opts.contentLocales}
            defaultContentLocale={opts.defaultContentLocale}
          />
        </>
      )
    },
  })

  return Route
}
