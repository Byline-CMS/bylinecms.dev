/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, notFound } from '@tanstack/react-router'

import { getSingletonAdminConfig, getWorkflowStatuses } from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import { z } from 'zod'

import { BreadcrumbsClient } from '../admin-shell/chrome/breadcrumbs/breadcrumbs-client.js'
import { SingletonHistoryView } from '../admin-shell/singletons/history.js'
import { getSingleton, getSingletonHistory } from '../server-fns/singletons/index.js'
import { getAdminRoutePath } from './admin-path.js'
import { getContentLocaleRouteConfig } from './get-content-locale-route-config.js'
import { getSingletonDefinition } from './get-singleton-definition.js'
import type { VersionHistoryData } from '../admin-shell/collections/version-history.js'

const searchSchema = z.object({
  page: z.coerce.number().min(1).optional(),
  page_size: z.coerce.number().max(100).optional(),
  order: z.string().optional(),
  desc: z.coerce.boolean().optional(),
  locale: z.string().optional(),
})

export function createSingletonHistoryRoute(path: string) {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic path bypasses route-tree typing
  const Route: any = createFileRoute(path as never)({
    validateSearch: searchSchema,
    loaderDeps: ({ search }: { search: z.infer<typeof searchSchema> }) => ({
      page: search.page,
      page_size: search.page_size,
      order: search.order,
      desc: search.desc,
      locale: search.locale,
    }),
    loader: async ({
      params,
      deps,
    }: {
      params: { singleton: string }
      deps: z.infer<typeof searchSchema>
    }) => {
      if (getSingletonDefinition(params.singleton) == null) throw notFound()

      const [history, currentDocument] = await Promise.all([
        getSingletonHistory({
          data: {
            singleton: params.singleton,
            params: {
              page: deps.page,
              page_size: deps.page_size,
              order: deps.order,
              desc: deps.desc,
              locale: deps.locale,
            },
          },
        }),
        // Use the same locale shape as the version stream so DiffModal compares
        // like with like. An empty slot returns null while history returns its
        // requested empty FindResult envelope.
        getSingleton({
          data: { singleton: params.singleton, locale: deps.locale ?? 'all' },
        }),
      ])

      return { history, currentDocument }
    },
    staleTime: 0,
    gcTime: 0,
    shouldReload: true,
    component: function SingletonHistoryRouteComponent() {
      const { history, currentDocument } = Route.useLoaderData()
      const { singleton } = Route.useParams() as { singleton: string }
      const definition = getSingletonDefinition(singleton)
      if (definition == null) throw notFound()

      const { t } = useTranslation('byline-admin')
      const { contentLocales, defaultContentLocale } = getContentLocaleRouteConfig()

      return (
        <>
          <BreadcrumbsClient
            breadcrumbs={[
              { label: t('chrome.menu.dashboard'), href: getAdminRoutePath() },
              {
                label: definition.label,
                href: getAdminRoutePath('singletons', singleton),
              },
              {
                label: t('collections.breadcrumbs.history'),
                href: getAdminRoutePath('singletons', singleton, 'history'),
              },
            ]}
          />
          <SingletonHistoryView
            singletonDefinition={definition}
            adminConfig={getSingletonAdminConfig(singleton) ?? undefined}
            data={history as VersionHistoryData}
            currentDocument={currentDocument as Record<string, unknown> | null}
            contentLocales={contentLocales}
            defaultContentLocale={defaultContentLocale}
            workflowStatuses={getWorkflowStatuses(definition)}
          />
        </>
      )
    },
  })

  return Route
}
