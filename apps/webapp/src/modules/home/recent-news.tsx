/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * The one section of the home page that is not a mock-up: the three most
 * recently published news items, read through the same `getNewsListFn`
 * the `/news` index uses (published-only, preview-aware, cached).
 *
 * Presentational only — the route loader supplies the result. Deliberately
 * mirrors the card vocabulary of `modules/news/components/list` so the home
 * page and the news index read as one site.
 *
 * Renders nothing at all when the collection is empty, so a fresh install
 * with no news yet shows a hero, an intro, and a footer rather than an
 * apologetic empty box.
 */

import { Link } from '@tanstack/react-router'

import { Badge, Card, ChevronRightIcon, Container, Section } from '@byline/ui/react'

import { useTranslations } from '@/i18n/client/translations-provider'
import { LangLink } from '@/i18n/components/lang-link'
import { lngParam, useLocale } from '@/i18n/hooks/use-locale-navigation'
import Logo from '@/images/byline-logo'
import { SectionHeader } from '@/modules/home/section-header'
import { ResponsiveImage } from '@/ui/byline/components/responsive-image'
import { truncate } from '@/utils/utils.general'
import type { NewsListResult } from '@/modules/news/list'

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

export function RecentNews({ result }: { result: NewsListResult }) {
  const { t } = useTranslations('frontend')
  const locale = useLocale()
  const docs = result.docs.slice(0, 3)

  if (docs.length === 0) return null

  return (
    <Section className="px-6 py-12 sm:py-16">
      <Container>
        <SectionHeader
          align="left"
          kicker={t('homeNewsKicker')}
          title={t('homeNewsTitle')}
          intro={t('homeNewsIntro')}
          action={
            <LangLink
              to="/news"
              className="inline-flex items-center gap-1 text-sm font-medium no-underline hover:underline"
            >
              {t('homeNewsViewAll')}
              <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
            </LangLink>
          }
        />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {docs.map((doc) => {
            const title = doc.fields.title ?? doc.path ?? doc.id
            const categoryLabel = doc.fields.category?.document?.fields.name
            const featureMedia = doc.fields.featureImage?.document?.fields
            const featureImage = featureMedia?.image
            const imageAlt = featureMedia?.altText ?? featureMedia?.title ?? title
            const publishedOn = doc.fields.publishedOn
              ? dateFormatter.format(new Date(doc.fields.publishedOn))
              : undefined
            const summary = doc.fields.summary ? truncate(doc.fields.summary, 130, true) : undefined

            return (
              <Link
                key={doc.id}
                to="/$lng/news/$path"
                params={{ ...lngParam(locale), path: doc.path ?? doc.id }}
                className="no-underline text-inherit"
              >
                <Card className="group flex h-full overflow-hidden">
                  {featureImage != null ? (
                    <ResponsiveImage
                      image={featureImage}
                      size="small"
                      alt={imageAlt}
                      className="aspect-video w-full shrink-0 bg-gray-100"
                      imgClassName="h-full w-full object-cover transition-transform duration-300 ease-in-out group-hover:scale-105"
                    />
                  ) : (
                    // Keeps the row's rhythm when an item has no feature
                    // image — a tinted band carrying a faint brand mark,
                    // so the gap reads as deliberate rather than broken.
                    <div
                      className="flex aspect-video w-full shrink-0 items-center justify-center bg-gradient-to-br from-purple-400/20 via-pink-500/15 to-amber-500/20"
                      aria-hidden="true"
                    >
                      <Logo className="h-10 w-10 opacity-20" />
                    </div>
                  )}
                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <div className="flex items-center gap-2">
                      {categoryLabel != null && (
                        <Badge className="m-0 text-xs">{categoryLabel}</Badge>
                      )}
                      {publishedOn != null && (
                        <span className="m-0 text-xs text-gray-400">{publishedOn}</span>
                      )}
                    </div>
                    <h3 className="m-0 text-lg font-semibold leading-snug">{title}</h3>
                    {summary != null ? (
                      <p className="m-0 text-sm leading-relaxed muted">{summary}</p>
                    ) : null}
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      </Container>
    </Section>
  )
}
