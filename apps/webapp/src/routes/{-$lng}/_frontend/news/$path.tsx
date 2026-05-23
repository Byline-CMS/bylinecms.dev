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

import {
  buildLocalizedPath,
  getMeta,
  /* metaImageFromUpload, */
  truncateForMeta,
} from '@/lib/meta'
import { NewsDetail } from '@/modules/news/components/detail'
import { getNewsDetailFn, type NewsDetailResult } from '@/modules/news/detail'
import { Breadcrumbs } from '@/ui/components/breadcrumbs'
// NOTE: This will restrict our retrieved content to front-end interface locales
// defined in i18nConfig, which is not exactly what we want. We want the available
// locales to be determined by the content locales in the CMS, but this is a
// good starting point for now until we settle on a content locale vs interface
// locale fallback or detection strategy.
import type { Locale } from '@/i18n/i18n-config'

// See `../$path.tsx` for notes on why this cast is needed.
type RouteLoaderData = { result: NonNullable<NewsDetailResult>; lng: Locale }

export const Route = createFileRoute('/{-$lng}/_frontend/news/$path')({
  loader: async ({ params, context }) => {
    const lng = context.locale
    const result = await getNewsDetailFn({ data: { path: params.path, lng } })
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

    return getMeta({
      title,
      description,
      path: buildLocalizedPath(lng, 'news', result.path),
      // image,
      ogType: 'article',
    })
  },
  component: RouteComponent,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
})

function RouteComponent() {
  const { result, lng } = Route.useLoaderData() as RouteLoaderData
  const title = result.fields.title ?? result.path ?? result.id

  return (
    <>
      <div
        id="byline-cms-meta"
        className="invisible max-h-0"
        aria-hidden
        data-collection="news"
        data-id={result.id}
      />
      <Section>
        <Container className="mt-3">
          <Breadcrumbs
            breadcrumbs={[
              { label: 'News', href: '/news' },
              { label: title, href: `/news/${result.path}` },
            ]}
          />
        </Container>
      </Section>
      <Section>
        <Container>
          <NewsDetail result={result} />
        </Container>
      </Section>
    </>
  )
}
