/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, notFound } from '@tanstack/react-router'

import { Container, Section } from '@infonomic/uikit/react'

import { NewsDetail } from '@/modules/news/components/detail'
import { getNewsDetailFn } from '@/modules/news/detail'
import { Breadcrumbs } from '@/ui/components/breadcrumbs'

export const Route = createFileRoute('/{-$lng}/_public/news/$slug')({
  loader: async ({ params }) => {
    const result = await getNewsDetailFn({ data: { slug: params.slug } })
    if (result == null) throw notFound()
    return result
  },
  component: RouteComponent,
})

function RouteComponent() {
  const result = Route.useLoaderData()
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
