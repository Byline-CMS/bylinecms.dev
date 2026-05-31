/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, notFound } from '@tanstack/react-router'

import { Container, Section } from '@byline/ui/react'

import { type RoutableLocale, toInterfaceLocale } from '@/i18n/i18n-config'
import {
  buildLocalizedPath,
  getMeta,
  /* metaImageFromUpload, */
  truncateForMeta,
} from '@/lib/meta'
import { DocDetail } from '@/modules/docs/components/detail'
import { type DocDetailResult, getDocDetailFn } from '@/modules/docs/detail'
import { BreadcrumbsClient } from '@/ui/components/breadcrumbs/breadcrumbs-client'
import { RouteError, RouteNotFound } from '@/ui/components/route-error'

// See `_frontend/$path.tsx` for notes on why this cast is needed.
type RouteLoaderData = { result: NonNullable<DocDetailResult>; lng: RoutableLocale }

export const Route = createFileRoute('/{-$lng}/_frontend/docs/$path')({
  loader: async ({ params, context }) => {
    const lng = context.locale
    const result = await getDocDetailFn({ data: { path: params.path, lng } })
    if (result == null) throw notFound()
    return { result, lng }
  },
  // See `_frontend/$path.tsx` for notes on how TanStack Router merges and
  // de-duplicates `head` output across the matched route chain.
  head: ({ loaderData }) => {
    const data = loaderData as RouteLoaderData | undefined
    if (data == null) return {}

    const { result, lng } = data
    const title = result.fields.title ?? result.path ?? result.id
    const summary = result.fields.summary?.trim()
    const description = summary != null && summary.length > 0 ? truncateForMeta(summary) : undefined

    return getMeta({
      title,
      description,
      path: buildLocalizedPath(lng, 'docs', result.path),
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
        data-collection="docs"
        data-id={result.id}
      />
      <BreadcrumbsClient
        breadcrumbs={[
          { label: 'Documentation', href: `/docs` },
          { label: title, href: `/docs/${result.path}` },
        ]}
      />
      <Section>
        <Container>
          <DocDetail result={result} lng={toInterfaceLocale(lng)} />
        </Container>
      </Section>
    </>
  )
}
