/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Docs search results page (`/<lng>/docs/search?q=…`). A dedicated, SSR'd,
 * shareable results route: the loader reads the `q` search param, runs the
 * ranked query server-side via `searchDocsFn`, and renders the hits. The
 * search box re-submits by navigating with a new `q` (no client-side fetch).
 *
 * A static route segment, so it takes precedence over the `docs/$` splat — a
 * document literally slugged `search` would be shadowed here (acceptable).
 */

import type React from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'

import { Container, Search, Section } from '@byline/ui/react'

import { useTranslations } from '@/i18n/client/translations-provider'
import { lngParam } from '@/i18n/hooks/use-locale-navigation'
import { toInterfaceLocale } from '@/i18n/i18n-config'
import { createTranslator } from '@/i18n/translations'
import { buildLocalizedPath, getMeta } from '@/lib/meta'
import { searchDocsFn } from '@/modules/docs/search'
import { BreadcrumbsClient } from '@/ui/components/breadcrumbs/breadcrumbs-client'
import { RouteError, RouteNotFound } from '@/ui/components/route-error'

interface DocsSearchParams {
  q?: string
}

export const Route = createFileRoute('/$lng/_frontend/docs/search')({
  validateSearch: (search: Record<string, unknown>): DocsSearchParams => ({
    q: typeof search.q === 'string' ? search.q : undefined,
  }),
  loaderDeps: ({ search: { q } }) => ({ q }),
  loader: async ({ context, deps: { q } }) => {
    const lng = context.locale
    const [result, { t }] = await Promise.all([
      searchDocsFn({ data: { query: q ?? '', lng } }),
      createTranslator(toInterfaceLocale(lng), 'frontend'),
    ])
    return { result, lng, q: q ?? '', title: t('docsSearchHeading') }
  },
  head: ({ loaderData, params }) =>
    getMeta({
      title: loaderData?.title ?? 'Search',
      path: buildLocalizedPath(params.lng, 'docs', 'search'),
    }),
  component: RouteComponent,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
})

function RouteComponent() {
  const { result, lng, q } = Route.useLoaderData()
  const { t } = useTranslations('frontend')
  const navigate = useNavigate()

  const runSearch = (value: string) => {
    navigate({
      to: '/$lng/docs/search',
      params: lngParam(lng),
      search: { q: value.trim() || undefined },
    })
  }

  return (
    <>
      <BreadcrumbsClient
        breadcrumbs={[
          { label: t('docsTitle'), href: '/docs' },
          { label: t('docsSearchHeading'), href: '/docs/search' },
        ]}
      />
      <Section className="pb-12">
        <Container>
          <div className="prose mb-6">
            <h1 className="mb-4">{t('docsSearchHeading')}</h1>
          </div>

          <Search
            key={q}
            defaultValue={q}
            placeHolderText={t('docsSearchPlaceholder')}
            ariaLabelForSearch={t('docsSearchPlaceholder')}
            onSearch={runSearch}
            onEnter={runSearch}
            className="mb-8 max-w-xl"
          />

          {q.length === 0 ? null : result.hits.length === 0 ? (
            <p className="muted">
              {t('docsSearchNoResults')} “{q}”.
            </p>
          ) : (
            <>
              <p className="muted mb-6">
                {result.total} {t('docsSearchResultsFor')} “{q}”
              </p>
              <ul className="not-prose flex flex-col gap-6">
                {result.hits.map((hit) => (
                  <li key={hit.id}>
                    <Link
                      to="/$lng/docs/$"
                      params={{ ...lngParam(lng), _splat: hit.chain.join('/') }}
                      className="text-lg font-semibold hover:underline"
                    >
                      {hit.title}
                    </Link>
                    {hit.snippet != null && (
                      <p className="muted mt-1 text-sm">
                        <Highlighted snippet={hit.snippet} />
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Container>
      </Section>
    </>
  )
}

/**
 * Render a `ts_headline` snippet safely: split on the `<mark>…</mark>` markers
 * the provider emits and render React `<mark>` elements, so the surrounding
 * snippet text is escaped by React (never injected as raw HTML).
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
