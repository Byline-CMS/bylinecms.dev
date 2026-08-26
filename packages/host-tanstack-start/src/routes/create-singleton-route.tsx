/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import type { DocumentPublishScheduleInfo } from '@byline/client'
import { getAdminBylineClient, getAdminRequestContext } from '@byline/client/server'
import {
  buildInitialDataFromFields,
  documentAbilityKey,
  getServerConfig,
  getSingletonAdminConfig,
} from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import { z } from 'zod'

import { BreadcrumbsClient } from '../admin-shell/chrome/breadcrumbs/breadcrumbs-client.js'
import { SingletonView } from '../admin-shell/singletons/view.js'
import { bylineCore } from '../integrations/byline-core.js'
import { serialise } from '../server-fns/serialise.js'
import { readSingletonDocument } from '../server-fns/singleton-document-read.js'
import { getAdminRoutePath } from './admin-path.js'
import { getContentLocaleRouteConfig } from './get-content-locale-route-config.js'
import { getSingletonDefinition } from './get-singleton-definition.js'

const searchSchema = z.object({ locale: z.string().optional() })

/**
 * Load the mapped singleton document and attach the admin-only lifecycle
 * metadata consumed by the editor. Keeping this composition in the route
 * layer leaves ordinary singleton reads free of publication timing and actor
 * capability details.
 */
export const getSingletonRouteDocument = createServerFn({ method: 'GET' })
  .validator((input: { singleton: string; locale?: string }) => input)
  .handler(async ({ data }) => {
    const definition = getSingletonDefinition(data.singleton)
    if (definition == null) return null

    const document = await readSingletonDocument({
      singleton: data.singleton,
      locale: data.locale,
      populateRelations: true,
    })
    if (document == null) {
      return {
        document: null,
        initialData: serialise(
          await buildInitialDataFromFields(definition.fields, {
            locale: data.locale ?? getServerConfig().i18n.content.defaultLocale,
          })
        ),
      }
    }

    const config = getServerConfig()
    const record = bylineCore().getCollectionRecord(data.singleton)

    // A current draft may coexist with an older published version. That fact
    // is editorial metadata, so it is intentionally attached only here rather
    // than to every singleton read.
    let publishedVersion: Record<string, any> | null = null
    if ((document as Record<string, unknown>).status !== 'published') {
      const published = await config.db.queries.documents.getPublishedVersion({
        collection_id: record.collectionId,
        document_id: String((document as Record<string, unknown>).id),
      })
      publishedVersion = published
        ? serialise({
            id: published.document_id,
            versionId: published.document_version_id,
            status: published.status,
            createdAt: published.created_at,
            updatedAt: published.updated_at,
          })
        : null
    }

    // Scheduling metadata is revealed only when the feature is enabled and
    // the authenticated actor holds both abilities needed to arm a publish.
    const scheduledPublicationEnabled = config.scheduledPublication?.enabled === true
    let canSchedulePublication = false
    let scheduledPublish: DocumentPublishScheduleInfo | null = null
    if (scheduledPublicationEnabled) {
      const actor = (await getAdminRequestContext()).actor
      canSchedulePublication =
        actor?.hasAbility(documentAbilityKey(definition, 'changeStatus')) === true &&
        actor.hasAbility(documentAbilityKey(definition, 'publish'))
      if (canSchedulePublication) {
        scheduledPublish = await getAdminBylineClient()
          .singleton(data.singleton)
          .getScheduledPublish()
      }
    }
    const serializedSchedule = scheduledPublish == null ? null : serialise(scheduledPublish)

    return {
      document: {
        ...(document as Record<string, unknown>),
        _publishedVersion: publishedVersion,
        _scheduledPublicationEnabled: scheduledPublicationEnabled,
        _canSchedulePublication: canSchedulePublication,
        _scheduledPublish: serializedSchedule,
        ...(serializedSchedule == null
          ? {}
          : {
              scheduledPublishAt: serializedSchedule.publishAt,
              scheduledPublishVersionId: serializedSchedule.targetVersionId,
            }),
      },
      initialData: undefined,
    }
  })

export function createSingletonRoute(path: string) {
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
      params: { singleton: string }
      deps: { locale?: string }
    }) => {
      if (getSingletonDefinition(params.singleton) == null) throw notFound()
      return getSingletonRouteDocument({
        data: { singleton: params.singleton, locale: deps.locale },
      })
    },
    staleTime: 0,
    gcTime: 0,
    shouldReload: true,
    component: function SingletonRouteComponent() {
      const routeState = Route.useLoaderData()
      const { singleton } = Route.useParams() as { singleton: string }
      const { locale } = Route.useSearch() as z.infer<typeof searchSchema>
      const definition = getSingletonDefinition(singleton)
      if (definition == null) throw notFound()

      const { t } = useTranslation('byline-admin')
      const { contentLocales, defaultContentLocale } = getContentLocaleRouteConfig()

      return (
        <>
          <BreadcrumbsClient
            breadcrumbs={[
              { label: t('chrome.menu.dashboard'), href: getAdminRoutePath() },
              { label: definition.label, href: getAdminRoutePath('singletons', singleton) },
            ]}
          />
          <SingletonView
            singletonDefinition={definition}
            adminConfig={getSingletonAdminConfig(singleton) ?? undefined}
            document={routeState.document}
            initialData={routeState.initialData}
            locale={locale}
            contentLocales={contentLocales}
            defaultContentLocale={defaultContentLocale}
          />
        </>
      )
    },
  })

  return Route
}
