/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router'

import { Container, Section } from '@byline/ui/react'

import { buildLocalizedPath, getMeta } from '@/lib/meta'
import { getNewsCategoriesFn } from '@/modules/news/categories'
import { NewsList } from '@/modules/news/components/list'
import { getNewsListFn } from '@/modules/news/list'
import { Breadcrumbs } from '@/ui/components/breadcrumbs'

interface NewsSearch {
  category?: string
}

export const Route = createFileRoute('/{-$lng}/_frontend/news/')({
  validateSearch: (search: Record<string, unknown>): NewsSearch => ({
    category: typeof search.category === 'string' ? search.category : undefined,
  }),
  loaderDeps: ({ search: { category } }) => ({ category }),
  loader: async ({ context, deps: { category } }) => {
    const lng = context.locale
    const [result, categories] = await Promise.all([
      getNewsListFn({ data: { lng, category } }),
      getNewsCategoriesFn({ data: { lng } }),
    ])
    return { result, lng, categories }
  },
  head: ({ params }) =>
    getMeta({
      title: 'News',
      path: buildLocalizedPath(params.lng, 'news'),
    }),
  component: RouteComponent,
})

function RouteComponent() {
  const { result, lng, categories } = Route.useLoaderData()
  const { category } = Route.useSearch()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  const onCategoryChange = (next: string | undefined) => {
    navigate({
      to: pathname as never,
      search: ((current: Record<string, unknown>) => {
        const out: Record<string, unknown> = { ...current }
        if (next == null) delete out.category
        else out.category = next
        return out
      }) as never,
    })
  }

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
          <NewsList
            result={result}
            categories={categories}
            category={category}
            onCategoryChange={onCategoryChange}
          />
        </Container>
      </Section>
    </>
  )
}
