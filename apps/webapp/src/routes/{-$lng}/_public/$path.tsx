/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, notFound } from '@tanstack/react-router'

import {
  RouteError,
  RouteNotFound,
} from '@byline/host-tanstack-start/admin-shell/chrome/route-error'
import { Container, Section } from '@byline/ui/react'

// NOTE: This will restrict our retrieved content to front-end interface locales
// defined in i18nConfig, which is not exactly what we want. We want the available
// locales to be determined by the content locales in the CMS, but this is a
// good starting point for now until we settle on a content locale vs interface
// locale fallback or detection strategy.
import { i18nConfig, type Locale } from '@/i18n/i18n-config'
import { PageDetail } from '@/modules/pages/components/detail'
import { getPageDetailFn } from '@/modules/pages/detail'
import { Breadcrumbs } from '@/ui/components/breadcrumbs'

export const Route = createFileRoute('/{-$lng}/_public/$path')({
  loader: async ({ params }) => {
    const lng = (i18nConfig.locales as readonly string[]).includes(params.lng ?? '')
      ? (params.lng as Locale)
      : i18nConfig.defaultLocale
    const path = params.path // string
    const result = await getPageDetailFn({ data: { path, lng } })
    if (result == null) throw notFound()
    return { result, lng }
  },
  component: RouteComponent,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
})

function RouteComponent() {
  const { result, lng } = Route.useLoaderData()
  const title = result.fields.title ?? result.path ?? result.id

  return (
    <>
      <div
        id="byline-cms-meta"
        className="invisible max-h-0"
        aria-hidden
        data-collection="pages"
        data-id={result.id}
      />
      <Section>
        <Container className="mt-3">
          <Breadcrumbs breadcrumbs={[{ label: title, href: `/${result.path}` }]} />
        </Container>
      </Section>
      <Section>
        <Container>
          <PageDetail result={result} lng={lng} />
        </Container>
      </Section>
    </>
  )
}
