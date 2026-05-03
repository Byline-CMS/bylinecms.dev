/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { Link } from '@tanstack/react-router'

import { Badge, Card } from '@infonomic/uikit/react'

import { ResponsiveImage } from '@/ui/byline/components/responsive-image'
import { RouterPager } from '@/ui/components/router-pager'
import { truncate } from '@/utils/utils.general'
import type { NewsListResult } from '@/modules/news/list'

interface NewsListProps {
  result: NewsListResult
  category?: string
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

export function NewsList({ result, category }: NewsListProps) {
  const { docs, meta } = result

  return (
    <div>
      <div className="flex items-center justify-between mb-4 prose">
        <h1 className="m-0">News</h1>
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
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500">
          <p>No news items found.</p>
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
                to="/{-$lng}/news/$slug"
                params={{ slug: doc.path ?? doc.id }}
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
