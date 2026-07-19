/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Public docs detail at a **hierarchical URL** — the splat route for the
 * `tree: true` docs collection (docs/04-collections/04-document-trees.md → "Public URL
 * resolution"). `params._splat` is everything after `/docs/`
 * (`getting-started/cli`). The loader leaf-resolves the document, derives the
 * ancestor chain, and:
 *   - 301s any non-canonical-but-reachable form (wrong/missing ancestors, a
 *     stale URL after a re-parent) to the canonical chain computed from the
 *     live tree — no stored redirect table; the redirect is *derived*;
 *   - 404s when the leaf does not resolve, or when an unpublished ancestor
 *     hides the subtree (public reads only — preview sees the full tree).
 *
 * This is a public read: it does NOT pass through the admin auth boundary.
 */

import { useMemo } from 'react'
import { createFileRoute, notFound, redirect } from '@tanstack/react-router'

import { Container, Section } from '@byline/ui/react'
import cx from 'classnames'

import { useTranslations } from '@/i18n/client/translations-provider'
import { useInterfaceLocale } from '@/i18n/hooks/use-locale-navigation'
import { advertisedLocalesFor, resolveAlternates } from '@/lib/alternates'
import { buildLocalizedPath, getMeta, truncateForMeta } from '@/lib/meta'
import { DocDetails } from '@/modules/docs/components/details'
import detailsLayoutStyles from '@/modules/docs/components/details-layout.module.css'
import { DocsPageUtilities } from '@/modules/docs/components/page-utilities'
import { DocsPrevNext } from '@/modules/docs/components/prev-next'
import { DocsToc } from '@/modules/docs/components/toc'
import { type DocSplatResult, getDocBySplatFn } from '@/modules/docs/details'
import { extractDocHeadings } from '@/modules/docs/toc'
import { BreadcrumbsClient } from '@/ui/components/breadcrumbs/breadcrumbs-client'
import { RouteError, RouteNotFound } from '@/ui/components/route-error'
import type { RoutableLocale } from '@/i18n/i18n-config'

// See `_frontend/$path.tsx` for notes on why this cast is needed.
type RouteLoaderData = { resolution: NonNullable<DocSplatResult>; lng: RoutableLocale }

/** Normalize a splat / chain to comparable, decoded, empty-free segments. */
function segmentsOf(splat: string): string[] {
  return splat
    .split('/')
    .map((s) => decodeURIComponent(s))
    .filter((s) => s.length > 0)
}

export const Route = createFileRoute('/$lng/_frontend/docs/$')({
  loader: async ({ params, context }) => {
    const lng = context.locale
    const splat = params._splat ?? ''
    const resolution = await getDocBySplatFn({ data: { splat, lng } })
    if (resolution == null) throw notFound()

    // Canonicalize: redirect any reachable-but-non-canonical form to the one
    // true URL derived from the live tree (301, self-healing after a re-parent).
    const requested = segmentsOf(splat).join('/')
    const canonical = resolution.chainSegments.join('/')
    if (requested !== canonical) {
      throw redirect({
        href: buildLocalizedPath(lng, 'docs', ...resolution.chainSegments),
        statusCode: 301,
      })
    }

    return { resolution, lng }
  },
  // See `_frontend/$path.tsx` for notes on how TanStack Router merges and
  // de-duplicates `head` output across the matched route chain.
  head: ({ loaderData }) => {
    const data = loaderData as RouteLoaderData | undefined
    if (data == null) return {}

    const { resolution, lng } = data
    const { doc, chainSegments } = resolution
    const title = doc.fields.title ?? doc.path ?? doc.id
    const summary = doc.fields.summary?.trim()
    const description = summary != null && summary.length > 0 ? truncateForMeta(summary) : undefined

    const { canonical, alternates, xDefaultPath } = resolveAlternates(
      advertisedLocalesFor(doc),
      lng,
      'docs',
      ...chainSegments
    )

    return getMeta({
      title,
      description,
      path: canonical,
      markdownAlternatePath: `${canonical}.md`,
      alternates,
      xDefaultPath,
      ogType: 'article',
    })
  },
  component: RouteComponent,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
})

function RouteComponent() {
  const { resolution, lng } = Route.useLoaderData() as RouteLoaderData
  const { doc, ancestors, chainSegments } = resolution
  const { t } = useTranslations('frontend')
  const interfaceLocale = useInterfaceLocale()
  const title = doc.fields.title ?? doc.path ?? doc.id

  // Contents are derived from the stored Lexical content rather than measured
  // from the DOM, so the rail is server-rendered with the page and its anchors
  // match the ids `HeadingWithAnchorSerializer` emits. See `@/modules/docs/toc`.
  const headings = useMemo(() => extractDocHeadings(doc.fields.content), [doc.fields.content])

  // The markdown representation this document already advertises — the same
  // URL carried by the head `rel=alternate` link.
  const markdownPath = `${buildLocalizedPath(lng, 'docs', ...chainSegments)}.md`

  // Breadcrumbs follow the tree (structure) but link to the composed
  // hierarchical URL (presentation) — each ancestor's href is the cumulative
  // chain up to and including it.
  const breadcrumbs = [
    { label: t('docsTitle'), href: '/docs' },
    ...ancestors.map((ancestor, i) => ({
      label: ancestor.title,
      href: `/docs/${chainSegments.slice(0, i + 1).join('/')}`,
    })),
    { label: title, href: `/docs/${chainSegments.join('/')}` },
  ]

  return (
    <>
      <div
        id="byline-cms-meta"
        className="invisible max-h-0"
        aria-hidden
        data-collection="docs"
        data-id={doc.id}
      />
      <BreadcrumbsClient breadcrumbs={breadcrumbs} />
      <Section>
        <Container>
          <div className={cx('byline-docs-details-layout', detailsLayoutStyles.layout)}>
            <div className={cx('byline-docs-details-main', detailsLayoutStyles.main)}>
              <DocsPageUtilities
                markdownPath={markdownPath}
                headings={headings}
                labels={{
                  copyPage: t('docsCopyPage'),
                  copied: t('docsCopyPageCopied'),
                  failed: t('docsCopyPageFailed'),
                  viewAsMarkdown: t('docsViewAsMarkdown'),
                  onThisPage: t('docsOnThisPage'),
                }}
              />
              <DocDetails result={doc} lng={interfaceLocale} />
              <DocsPrevNext currentChain={chainSegments.join('/')} lng={interfaceLocale} />
            </div>
            <DocsToc headings={headings} label={t('docsOnThisPage')} />
          </div>
        </Container>
      </Section>
    </>
  )
}
