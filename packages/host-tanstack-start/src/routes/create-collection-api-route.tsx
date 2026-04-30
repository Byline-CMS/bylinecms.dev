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

import { BreadcrumbsClient } from '../admin-shell/chrome/breadcrumbs/breadcrumbs-client.js'
import { ApiView } from '../admin-shell/collections/api.js'
import { getCollectionDocument } from '../server-fns/collections/index.js'
import type { ContentLocaleOption } from '../admin-shell/collections/view-menu.js'

const searchSchema = z.object({
  locale: z.string().optional(),
  /**
   * Populate depth for relation fields. Capped at 3 to avoid runaway
   * fan-out in the admin preview. Programmatic callers via
   * `@byline/client` can go deeper.
   */
  depth: z.coerce.number().int().min(0).max(3).optional(),
})

interface CollectionApiOpts {
  contentLocales: ReadonlyArray<ContentLocaleOption>
  defaultContentLocale: string
}

export function createCollectionApiRoute(path: string, opts: CollectionApiOpts) {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic path bypasses route-tree typing
  const Route: any = createFileRoute(path as never)({
    validateSearch: searchSchema,
    loaderDeps: ({ search }: { search: z.infer<typeof searchSchema> }) => ({
      locale: search.locale,
      depth: search.depth,
    }),
    loader: async ({
      params,
      deps,
    }: {
      params: { collection: string; id: string }
      deps: { locale?: string; depth?: number }
    }) => {
      const collectionDef = getCollectionDefinition(params.collection)
      if (!collectionDef) {
        throw notFound()
      }

      // 'all' is now always explicit in the URL when the user picks it.
      // No locale param means the user hasn't made a selection yet — default
      // to the content default locale (same as History and Edit behaviours).
      const resolvedLocale = deps.locale ?? opts.defaultContentLocale
      const data = await getCollectionDocument(
        params.collection,
        params.id,
        resolvedLocale,
        deps.depth
      )

      if (!data) {
        throw notFound()
      }

      return data
    },
    staleTime: 0,
    gcTime: 0,
    shouldReload: true,
    component: function CollectionApiComponent() {
      const data = Route.useLoaderData()
      const { collection, id } = Route.useParams() as { collection: string; id: string }
      const { locale, depth } = Route.useSearch() as z.infer<typeof searchSchema>
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
            contentLocales={opts.contentLocales}
            defaultContentLocale={opts.defaultContentLocale}
          />
        </>
      )
    },
  })

  return Route
}
