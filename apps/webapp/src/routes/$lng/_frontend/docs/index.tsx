/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Docs landing page and search results (`/<lng>/docs`, optionally `?q=…`).
 *
 * Search results live on this route rather than a `docs/search` child on
 * purpose: any static segment under `docs/` shadows the `docs/$` splat, so a
 * document slugged with that segment becomes unreachable. The Search section's
 * own index is slugged `search`, which is exactly that collision. Keeping the
 * query on the index route means every `docs/<slug>` URL is always a document.
 *
 * With no `q` the route renders the table of contents; with a `q` it runs the
 * ranked query server-side via `searchDocsFn` and renders the hits. The search
 * box re-submits by navigating with a new `q` (no client-side fetch).
 */

import type React from 'react'
import { createFileRoute, Link, useLoaderData } from '@tanstack/react-router'

import { Container, Section } from '@byline/ui/react'

import { useTranslations } from '@/i18n/client/translations-provider'
import { lngParam, useInterfaceLocale } from '@/i18n/hooks/use-locale-navigation'
import { toInterfaceLocale } from '@/i18n/i18n-config'
import { createTranslator } from '@/i18n/translations'
import { buildLocalizedPath, getMeta } from '@/lib/meta'
import { DocsList } from '@/modules/docs/components/list'
import { searchDocsFn } from '@/modules/docs/search'
import { BreadcrumbsClient } from '@/ui/components/breadcrumbs/breadcrumbs-client'
import { RouteError, RouteNotFound } from '@/ui/components/route-error'

interface DocsSearchParams {
  q?: string
}

export const Route = createFileRoute('/$lng/_frontend/docs/')({
  validateSearch: (search: Record<string, unknown>): DocsSearchParams => ({
    q: typeof search.q === 'string' ? search.q : undefined,
  }),
  loaderDeps: ({ search: { q } }) => ({ q }),
  // Resolve the localized <title> server-side: head() is synchronous and
  // runs outside the React TranslationsProvider, so the title is computed
  // here (context.locale is available) and read back via loaderData.
  loader: async ({ context, deps: { q } }) => {
    const lng = context.locale
    const query = q ?? ''
    const [{ t }, result] = await Promise.all([
      createTranslator(toInterfaceLocale(lng), 'frontend'),
      query.trim().length > 0 ? searchDocsFn({ data: { query, lng } }) : undefined,
    ])
    return {
      title: query.trim().length > 0 ? t('docsSearchHeading') : t('docsTitle'),
      q: query,
      result,
    }
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
  // truth, no re-fetch, no own loader needed for the nav. The nav is the
  // document tree; the card grid shows every doc in tree (pre-order) order.
  const { nodes } = useLoaderData({ from: '/$lng/_frontend/docs' })
  const { q, result } = Route.useLoaderData()
  const { t } = useTranslations('frontend')
  const interfaceLocale = useInterfaceLocale()

  // In search mode the query gets its own trailing crumb (rendered as the
  // current page, not a link), which leaves "Documentation" as a plain `/docs`
  // link — clicking it drops `q` and returns to the table of contents. Hrefs
  // must stay distinct: the renderer keys crumbs by href.
  //
  // The crumb is labelled "Query", not "Search": the Search docs section is
  // itself a document titled "Search", so reusing that word here reads as a
  // link to that page rather than as the active query.
  const breadcrumbs =
    result != null
      ? [
          { label: t('docsTitle'), href: '/docs' },
          { label: t('docsSearchBreadcrumb'), href: `/docs?q=${encodeURIComponent(q)}` },
        ]
      : [{ label: t('docsTitle'), href: '/docs' }]

  return (
    <>
      <BreadcrumbsClient breadcrumbs={breadcrumbs} />
      <Section className="pb-12">
        {result != null ? (
          <Container className="max-w-[960px] mx-auto overflow-x-auto">
            <SearchResults q={q} result={result} lng={interfaceLocale} />
          </Container>
        ) : nodes.length > 0 ? (
          <Container>
            <DocsList nodes={nodes} lng={interfaceLocale} />
          </Container>
        ) : (
          <Container>
            <div className="prose mb-8">
              <h1 className="mb-2">{t('docsTitle')}</h1>
              <p className="muted">{t('docsEmpty')}</p>
            </div>
          </Container>
        )}
      </Section>
    </>
  )
}

function SearchResults({
  q,
  result,
  lng,
}: {
  q: string
  result: NonNullable<Awaited<ReturnType<typeof searchDocsFn>>>
  lng: ReturnType<typeof useInterfaceLocale>
}): React.JSX.Element {
  const { t } = useTranslations('frontend')

  return (
    <>
      <div className="prose mb-0">
        <h1 className="mb-4">{t('docsSearchHeading')}</h1>
      </div>

      {result.hits.length === 0 ? (
        <p className="muted">
          {t('docsSearchNoResults')} “{q}”.
        </p>
      ) : (
        <>
          <p className="muted mb-4">
            {result.total} {t('docsSearchResultsFor')} “{q}”
          </p>
          <ul className="not-prose flex flex-col gap-6">
            {result.hits.map((hit) => (
              <li key={hit.id}>
                <Link
                  to="/$lng/docs/$"
                  params={{ ...lngParam(lng), _splat: hit.chain.join('/') }}
                  className="text-[1.3rem] hover:underline"
                >
                  {hit.title}
                </Link>
                {hit.snippet != null && (
                  <p className="muted mt-1 text-gray-500 dark:text-gray-300">
                    <Highlighted snippet={hit.snippet} />
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

/**
 * Render a provider snippet safely: split on the portable `<mark>…</mark>`
 * markers and render React `<mark>` elements, so the surrounding snippet text
 * is escaped by React (never injected as raw HTML).
 */
function Highlighted({ snippet }: { snippet: string }): React.JSX.Element {
  const parts = snippet.split(/(<mark>.*?<\/mark>)/g)
  return (
    <>
      {parts.map((part, i) => {
        const match = /^<mark>(.*?)<\/mark>$/.exec(part)
        if (match != null) {
          // biome-ignore lint/suspicious/noArrayIndexKey: positional split, stable per render
          return <mark key={i}>{match[1]}</mark>
        }
        // biome-ignore lint/suspicious/noArrayIndexKey: positional split, stable per render
        return <span key={i}>{part}</span>
      })}
    </>
  )
}
