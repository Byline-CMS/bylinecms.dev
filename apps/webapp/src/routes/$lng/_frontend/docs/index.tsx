/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, useLoaderData } from '@tanstack/react-router'

import { Container, Section } from '@byline/ui/react'

import { useTranslations } from '@/i18n/client/translations-provider'
import { useInterfaceLocale } from '@/i18n/hooks/use-locale-navigation'
import { resolveInterfaceLocale } from '@/i18n/resolve-interface-locale-fn'
import { createTranslator } from '@/i18n/translations'
import { buildLocalizedPath, getMeta } from '@/lib/meta'
import { DocsList } from '@/modules/docs/components/list'
import { BreadcrumbsClient } from '@/ui/components/breadcrumbs/breadcrumbs-client'
import { RouteError, RouteNotFound } from '@/ui/components/route-error'

export const Route = createFileRoute('/$lng/_frontend/docs/')({
  // Resolve the localized <title> server-side: head() is synchronous and
  // runs outside the React TranslationsProvider, so the title is computed
  // here (context.locale is available) and read back via loaderData.
  loader: async ({ context }) => {
    const interfaceLocale = await resolveInterfaceLocale(context.locale)
    const { t } = await createTranslator(interfaceLocale, 'frontend')
    return { title: t('docsTitle') }
  },
  head: ({ loaderData, params }) =>
    getMeta({
      title: loaderData?.title ?? 'Documentation',
      path: buildLocalizedPath(params.lng, 'docs'),
    }),
  component: RouteComponent,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
})

function RouteComponent() {
  // Read the parent docs layout's loader data directly — single source of
  // truth, no re-fetch, no own loader needed on this index route.
  const { docs } = useLoaderData({ from: '/$lng/_frontend/docs' })
  const { t } = useTranslations('frontend')
  const interfaceLocale = useInterfaceLocale()

  return (
    <>
      <BreadcrumbsClient breadcrumbs={[{ label: t('docsTitle'), href: '/docs' }]} />
      <Section className="pb-12">
        <Container>
          {docs.length > 0 ? (
            <DocsList docs={docs} lng={interfaceLocale} />
          ) : (
            <div className="prose mb-8">
              <h1 className="mb-2">{t('docsTitle')}</h1>
              <p className="muted">{t('docsEmpty')}</p>
            </div>
          )}
        </Container>
      </Section>
    </>
  )
}
