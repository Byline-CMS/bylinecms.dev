/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, notFound } from '@tanstack/react-router'

import { Container, Section } from '@byline/ui/react'

import { useInterfaceLocale } from '@/i18n/hooks/use-locale-navigation'
import { advertisedLocalesFor, resolveAlternates } from '@/lib/alternates'
import {
  getMeta,
  /* metaImageFromUpload, */
  truncateForMeta,
} from '@/lib/meta'
import { PageDetail } from '@/modules/pages/components/detail'
import { getPageDetailFn, type PageDetailResult } from '@/modules/pages/detail'
import { Breadcrumbs } from '@/ui/components/breadcrumbs'
import { RouteError, RouteNotFound } from '@/ui/components/route-error'
import type { RoutableLocale } from '@/i18n/i18n-config'

// Shape of this route's loader return. Used to narrow `loaderData` inside
// `head()` — TanStack Start's server-fn types currently strip the
// `ClientDocument<…>` return down to `{}` via `ValidateSerializableInput`,
// so we cast back to the actual shape we know the loader produces. The same
// pattern is used implicitly by `RouteComponent` below via
// `Route.useLoaderData()`.
type RouteLoaderData = { result: NonNullable<PageDetailResult>; lng: RoutableLocale }

export const Route = createFileRoute('/$lng/_frontend/$path')({
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

    const { canonical, alternates, xDefaultPath } = resolveAlternates(
      advertisedLocalesFor(result),
      lng,
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
          <Breadcrumbs breadcrumbs={[{ label: title, href: `/${result.path}` }]} />
        </Container>
      </Section>
      <PageDetail result={result} lng={interfaceLocale} />
    </>
  )
}
