/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect, useRef } from 'react'
import { createFileRoute, notFound } from '@tanstack/react-router'

import type { CollectionDefinition } from '@byline/core'
import { getCollectionAdminConfig, getCollectionDefinition } from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import { useToastManager } from '@byline/ui/react'
import { z } from 'zod'

import { BreadcrumbsClient } from '../admin-shell/chrome/breadcrumbs/breadcrumbs-client.js'
import { useNavigate } from '../admin-shell/chrome/loose-router.js'
import { EditView } from '../admin-shell/collections/edit.js'
import { getCollectionDocument } from '../server-fns/collections/index.js'
import { getAdminRoutePath } from './admin-path.js'
import { getContentLocaleRouteConfig } from './get-content-locale-route-config.js'
import { decodeListReturnState } from './list-return-state.js'

const searchSchema = z.object({
  locale: z.string().optional(),
  /** Set by the create view's create → edit redirect; fires the created toast. */
  action: z.enum(['created']).optional(),
  /** URL-encoded list search state to return to on close — see list-return-state.ts. */
  from: z.string().optional(),
})

export function createCollectionEditRoute(path: string) {
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
      // target's `CollectionAdminConfig.itemView` columns.
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
      const search = Route.useSearch() as z.infer<typeof searchSchema>
      const { locale } = search
      const collectionDef = getCollectionDefinition(collection) as CollectionDefinition
      const adminConfig = getCollectionAdminConfig(collection)
      const { t } = useTranslation('byline-admin')
      const toastManager = useToastManager()
      const navigate = useNavigate()
      const { contentLocales, defaultContentLocale } = getContentLocaleRouteConfig()

      // Post-create toast for the create → edit redirect (?action=created).
      // Ref-guarded for the same reason as the list route's created toast:
      // `toastManager` changes identity on every add, so the effect depends
      // on the stable `toastManager.add` and the ref protects against any
      // re-fire that observes the search param before navigate clears it.
      const createdToastFiredRef = useRef(false)
      useEffect(() => {
        if (search.action !== 'created') {
          createdToastFiredRef.current = false
          return
        }
        if (createdToastFiredRef.current) return
        createdToastFiredRef.current = true

        toastManager.add({
          title: t('collections.list.createdToastTitle', { label: collectionDef.labels.singular }),
          description: t('collections.list.createdToastDescription', {
            label: collectionDef.labels.singular.toLowerCase(),
          }),
          data: {
            intent: 'success',
            iconType: 'success',
            icon: true,
            close: true,
          },
        })
        navigate({
          to: '.',
          search: (prev: Record<string, unknown>) => ({ ...prev, action: undefined }),
          replace: true,
        })
      }, [search.action, navigate, toastManager.add, collectionDef.labels.singular, t])

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
                label: t('common.actions.edit'),
                href: getAdminRoutePath('collections', collection, id),
              },
            ]}
          />
          <EditView
            collectionDefinition={collectionDef}
            adminConfig={adminConfig ?? undefined}
            initialData={data}
            locale={locale}
            contentLocales={contentLocales}
            defaultContentLocale={defaultContentLocale}
            returnSearch={decodeListReturnState(search.from)}
          />
        </>
      )
    },
  })

  return Route
}
