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
import { BreadcrumbsClient } from '@byline/host-tanstack-start/admin-shell/chrome/breadcrumbs/breadcrumbs-client'
import { EditView } from '@byline/host-tanstack-start/admin-shell/collections/edit'
import { getCollectionDocument } from '@byline/host-tanstack-start/server-fns/collections'
import { z } from 'zod'

import { contentLocales, i18n } from '~/i18n'

const searchSchema = z.object({
  locale: z.string().optional(),
})

export const Route = createFileRoute('/(byline)/admin/collections/$collection/$id/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search: { locale } }) => ({ locale }),
  loader: async ({ params, deps: { locale } }) => {
    const collectionDef = getCollectionDefinition(params.collection)
    if (!collectionDef) {
      throw notFound()
    }

    // Auto-populate direct relation fields (depth 1) so the edit form's
    // relation-summary tiles render with target data (category name, media
    // thumbnail, etc.) on first paint. Projection is derived from each
    // target's `CollectionAdminConfig.picker` columns.
    const data = await getCollectionDocument(params.collection, params.id, locale, undefined, true)

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
  const { locale } = Route.useSearch()
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
        contentLocales={contentLocales}
        defaultContentLocale={i18n.content.defaultLocale}
      />
    </>
  )
}
