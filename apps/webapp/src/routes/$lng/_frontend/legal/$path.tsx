/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, notFound } from '@tanstack/react-router'

import { Container, Section } from '@byline/ui/react'

import { useTranslations } from '@/i18n/client/translations-provider'
import { useInterfaceLocale } from '@/i18n/hooks/use-locale-navigation'
import { advertisedLocalesFor, resolveAlternates } from '@/lib/alternates'
import {
  getMeta,
  /* metaImageFromUpload, */
  truncateForMeta,
} from '@/lib/meta'
import { PageDetails } from '@/modules/pages/components/details'
import { getPageDetailsFn, type PageDetailsResult } from '@/modules/pages/details'
import { Breadcrumbs } from '@/ui/components/breadcrumbs'
import { RouteError, RouteNotFound } from '@/ui/components/route-error'
import type { RoutableLocale } from '@/i18n/i18n-config'

// See `../$path.tsx` for notes on why this cast is needed.
type RouteLoaderData = { result: NonNullable<PageDetailsResult>; lng: RoutableLocale }

export const Route = createFileRoute('/$lng/_frontend/legal/$path')({
  loader: async ({ params, context }) => {
    const lng = context.locale
    const result = await getPageDetailsFn({ data: { path: params.path, lng } })
    if (result == null) throw notFound()
    return { result, lng }
  },
  // See `../$path.tsx` for notes on how TanStack Router merges and
  // de-duplicates `head` output across the matched route chain.
  head: ({ loaderData }) => {
    const data = loaderData as RouteLoaderData | undefined
    if (data == null) return {}

    const { result, lng } = data
    const title = result.fields.title ?? result.path ?? result.id
    const summary = result.fields.summary?.trim()
    const description = summary != null && summary.length > 0 ? truncateForMeta(summary) : undefined

    // Feature-image extraction — wired up but disabled until media is
    // served from S3 + a public CDN. See `../$path.tsx` for full notes.
    // const featureMedia = result.fields.featureImage?.document?.fields
    // const image = metaImageFromUpload(featureMedia?.image, featureMedia?.altText ?? title)

    const { canonical, alternates, xDefaultPath } = resolveAlternates(
      advertisedLocalesFor(result),
      lng,
      'legal',
      result.path
    )

    return getMeta({
      title,
      description,
      path: canonical,
      markdownAlternatePath: `${canonical}.md`,
      alternates,
      xDefaultPath,
      // image,
      ogType: 'article',
    })
  },
  component: RouteComponent,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
})

function RouteComponent() {
  const { result } = Route.useLoaderData() as RouteLoaderData
  const { t } = useTranslations('frontend')
  const interfaceLocale = useInterfaceLocale()
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
          <Breadcrumbs
            breadcrumbs={[
              { label: t('legal'), href: `/` },
              { label: title, href: `/legal/${result.path}` },
            ]}
          />
        </Container>
      </Section>
      <PageDetails result={result} lng={interfaceLocale} />
    </>
  )
}
