/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { Link } from '@tanstack/react-router'

import { Badge, Card, Select } from '@byline/ui/react'

import { useTranslations } from '@/i18n/client/translations-provider'
import { lngParam, useLocale } from '@/i18n/hooks/use-locale-navigation'
import { ResponsiveImage } from '@/ui/byline/components/responsive-image'
import { RouterPager } from '@/ui/components/router-pager'
import { truncate } from '@/utils/utils.general'
import type { NewsCategoriesListResult } from '@/modules/news/categories'
import type { NewsListResult } from '@/modules/news/list'

interface NewsListProps {
  result: NewsListResult
  categories: NewsCategoriesListResult
  category?: string
  onCategoryChange: (next: string | undefined) => void
}

const ALL_CATEGORIES = '__all__'

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

export function NewsList({ result, categories, category, onCategoryChange }: NewsListProps) {
  const { docs, meta } = result
  const locale = useLocale()
  const { t } = useTranslations('frontend')

  const categoryItems = [
    { value: ALL_CATEGORIES, label: t('newsAllCategories') },
    ...categories.docs.map((doc) => ({
      value: doc.path ?? doc.id,
      label: doc.fields.name ?? doc.path ?? doc.id,
    })),
  ]

  const handleCategoryChange = (value: string | null) => {
    if (value == null) return
    onCategoryChange(value === ALL_CATEGORIES ? undefined : value)
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center  mb-4 prose">
        <h1 className="m-0 mr-auto mb-2 sm:mb-0">{t('navNews')}</h1>
        <Select<string>
          ariaLabel={t('newsFilterByCategory')}
          size="sm"
          variant="outlined"
          value={category ?? ALL_CATEGORIES}
          items={categoryItems}
          onValueChange={handleCategoryChange}
        />
        <RouterPager
          page={meta.page}
          count={meta.totalPages}
          showFirstButton
          showLastButton
          componentName="pagerTop"
          aria-label="Top Pager"
        />
      </div>
      {docs.length === 0 ? (
        <div className="p-6 text-center text-gray-800 dark:text-gray-300">
          <p>{t('newsEmpty')}</p>
        </div>
      ) : (
        <div className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6 p-0">
          {docs.map((doc) => {
            const title = doc.fields.title ?? doc.path ?? doc.id
            const categoryLabel = doc.fields.category?.document?.fields.name
            const featureMedia = doc.fields.featureImage?.document?.fields
            const featureImage = featureMedia?.image
            const imageAlt = featureMedia?.altText ?? featureMedia?.title ?? title
            const publishedOn = doc.fields.publishedOn
              ? dateFormatter.format(new Date(doc.fields.publishedOn))
              : undefined
            const summary = doc.fields.summary ? truncate(doc.fields.summary, 150, true) : undefined

            return (
              <Link
                key={doc.id}
                to="/$lng/news/$path"
                params={{ ...lngParam(locale), path: doc.path ?? doc.id }}
                className="no-underline text-inherit"
              >
                <Card className="flex overflow-hidden group h-full">
                  {featureImage ? (
                    <ResponsiveImage
                      image={featureImage}
                      size="small"
                      alt={imageAlt}
                      className="aspect-video w-full shrink-0 bg-gray-100"
                      imgClassName="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300 ease-in-out"
                    />
                  ) : null}
                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <div className="flex items-center gap-2">
                      {categoryLabel && <Badge className="m-0 text-xs">{categoryLabel}</Badge>}
                      {publishedOn && (
                        <span className="m-0 text-xs text-gray-400">{publishedOn}</span>
                      )}
                    </div>
                    <h2>{title}</h2>
                    {summary ? (
                      <p className="m-0 text-sm muted leading-relaxed">{summary}</p>
                    ) : null}
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
