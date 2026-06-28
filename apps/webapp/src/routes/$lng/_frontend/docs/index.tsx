/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, useLoaderData, useNavigate } from '@tanstack/react-router'

import { Container, Search, Section } from '@byline/ui/react'

import { useTranslations } from '@/i18n/client/translations-provider'
import { lngParam, useInterfaceLocale } from '@/i18n/hooks/use-locale-navigation'
import { toInterfaceLocale } from '@/i18n/i18n-config'
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
    const { t } = await createTranslator(toInterfaceLocale(context.locale), 'frontend')
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
  // truth, no re-fetch, no own loader needed on this index route. The nav is
  // the document tree; the card grid shows every doc in tree (pre-order) order.
  const { nodes } = useLoaderData({ from: '/$lng/_frontend/docs' })
  const { t } = useTranslations('frontend')
  const interfaceLocale = useInterfaceLocale()
  const navigate = useNavigate()

  // Submit (click / enter) navigates to the dedicated, shareable results
  // route; the search runs server-side there. No type-ahead.
  const runSearch = (value: string) => {
    const q = value.trim()
    if (q.length === 0) return
    navigate({ to: '/$lng/docs/search', params: lngParam(interfaceLocale), search: { q } })
  }

  return (
    <>
      <BreadcrumbsClient breadcrumbs={[{ label: t('docsTitle'), href: '/docs' }]} />
      <Section className="pb-12">
        <Container>
          <Search
            placeHolderText={t('docsSearchPlaceholder')}
            ariaLabelForSearch={t('docsSearchPlaceholder')}
            onSearch={runSearch}
            onEnter={runSearch}
            className="mb-8 max-w-xl"
          />
          {nodes.length > 0 ? (
            <DocsList nodes={nodes} lng={interfaceLocale} />
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
