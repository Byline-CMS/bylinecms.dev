/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute } from '@tanstack/react-router'

import { Container, Section } from '@infonomic/uikit/react'

import { NewsList } from '@/modules/news/components/list'
import { getNewsListFn } from '@/modules/news/list'
import { Breadcrumbs } from '@/ui/components/breadcrumbs'

interface NewsSearch {
  category?: string
}

export const Route = createFileRoute('/{-$lng}/_public/news/')({
  validateSearch: (search: Record<string, unknown>): NewsSearch => ({
    category: typeof search.category === 'string' ? search.category : undefined,
  }),
  loaderDeps: ({ search: { category } }) => ({ category }),
  loader: ({ deps: { category } }) => getNewsListFn({ data: { category } }),
  component: RouteComponent,
})

function RouteComponent() {
  const result = Route.useLoaderData()
  const { category } = Route.useSearch()
  // console.log('News list result', JSON.stringify({ result, category }, null, 2))
  return (
    <>
      <div id="byline-cms-meta" className="invisible max-h-0" aria-hidden data-collection="news" />
      <Section>
        <Container className="mt-3">
          <Breadcrumbs breadcrumbs={[{ label: 'News', href: '/news' }]} />
        </Container>
      </Section>
      <Section>
        <Container>
          <NewsList result={result} category={category} />
        </Container>
      </Section>
    </>
  )
}
