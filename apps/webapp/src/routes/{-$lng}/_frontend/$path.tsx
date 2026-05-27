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
import { PageDetail } from '@/modules/pages/components/detail'
import { getPageDetailFn, type PageDetailResult } from '@/modules/pages/detail'
import { Breadcrumbs } from '@/ui/components/breadcrumbs'
// NOTE: This will restrict our retrieved content to front-end interface locales
// defined in i18nConfig, which is not exactly what we want. We want the available
// locales to be determined by the content locales in the CMS, but this is a
// good starting point for now until we settle on a content locale vs interface
// locale fallback or detection strategy.
import type { Locale } from '@/i18n/i18n-config'

// Shape of this route's loader return. Used to narrow `loaderData` inside
// `head()` — TanStack Start's server-fn types currently strip the
// `ClientDocument<…>` return down to `{}` via `ValidateSerializableInput`,
// so we cast back to the actual shape we know the loader produces. The same
// pattern is used implicitly by `RouteComponent` below via
// `Route.useLoaderData()`.
type RouteLoaderData = { result: NonNullable<PageDetailResult>; lng: Locale }

export const Route = createFileRoute('/{-$lng}/_frontend/$path')({
  loader: async ({ params, context }) => {
    const lng = context.locale
    const result = await getPageDetailFn({ data: { path: params.path, lng } })
    if (result == null) throw notFound()
    return { result, lng }
  },
  // The `head` function is merged with every other matched route's `head`
  // (root + layout + leaf). Meta entries are de-duplicated by their
  // identifying key (`title`, `name`, `property`, `httpEquiv`, `charSet`),
  // with later entries winning — so anything declared here overrides the
  // defaults from `__root.tsx`'s `getMeta()` call.
  head: ({ loaderData }) => {
    const data = loaderData as RouteLoaderData | undefined
    if (data == null) return {}

    const { result, lng } = data
    const title = result.fields.title ?? result.path ?? result.id
    const summary = result.fields.summary?.trim()
    const description = summary != null && summary.length > 0 ? truncateForMeta(summary) : undefined

    // Feature-image extraction — wired up but disabled until media is
    // served from S3 + a public CDN. Today `storageUrl` is a local
    // filesystem path that external OG/social scrapers can't fetch, so
    // we let `getMeta`'s default `/opengraph-image.png` win. Once the
    // storage adapter is swapped over, uncomment the two lines below and
    // pass `image` to `getMeta`.
    // const featureMedia = result.fields.featureImage?.document?.fields
    // const image = metaImageFromUpload(featureMedia?.image, featureMedia?.altText ?? title)

    return getMeta({
      title,
      description,
      path: buildLocalizedPath(lng, result.path),
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
        data-collection="pages"
        data-id={result.id}
      />
      <Section>
        <Container className="mt-3">
          <Breadcrumbs breadcrumbs={[{ label: title, href: `/${result.path}` }]} />
        </Container>
      </Section>
      <PageDetail result={result} lng={lng} />
    </>
  )
}
