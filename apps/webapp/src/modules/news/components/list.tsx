/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { PersistedVariant, StoredFileValue } from '@byline/core'
import { Card } from '@infonomic/uikit/react'

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

// Pick a named variant URL from a stored image, falling back to the next
// preferred variant and finally the original `storageUrl`. The variant list
// itself is just `image.variants`, but the fallback chain is real logic
// worth a name.
function pickVariantUrl(
  image: StoredFileValue | undefined,
  ...preferred: string[]
): string | undefined {
  if (!image) return undefined
  const variants: PersistedVariant[] = image.variants ?? []
  for (const name of preferred) {
    const hit = variants.find((v) => v.name === name)
    if (hit?.storageUrl) return hit.storageUrl
  }
  return image.storageUrl
}

export function NewsList({ result, category }: NewsListProps) {
  const { docs, meta } = result

  return (
    <div>
      <header className="mb-4">
        <p className="text-sm text-gray-500">
          {meta.total} {meta.total === 1 ? 'item' : 'items'}
          {category ? ` in "${category}"` : ''}
        </p>
      </header>

      {docs.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500">
          <p>No news items found.</p>
        </div>
      ) : (
        <div className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6 p-0">
          {docs.map((doc) => {
            const title = doc.fields.title ?? doc.path ?? doc.id
            const categoryLabel = doc.fields.category?.document?.fields.name
            const featureImage = doc.fields.featureImage?.document?.fields.image
            const thumbnailUrl = pickVariantUrl(featureImage, 'thumbnail', 'card')
            const imageAlt =
              doc.fields.featureImage?.document?.fields.altText ??
              doc.fields.featureImage?.document?.fields.title ??
              title
            const publishedOn = doc.fields.publishedOn
              ? dateFormatter.format(new Date(doc.fields.publishedOn))
              : undefined
            const summary = doc.fields.summary ? truncate(doc.fields.summary, 150, true) : undefined

            return (
              <Card key={doc.id} className="flex overflow-hidden group">
                {thumbnailUrl ? (
                  <div className="aspect-video w-full shrink-0 overflow-hidden bg-gray-100">
                    <img
                      src={thumbnailUrl}
                      alt={imageAlt}
                      className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300 ease-in-out"
                    />
                  </div>
                ) : null}
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <h2>{title}</h2>
                  {publishedOn || categoryLabel ? (
                    <p className="m-0 text-xs text-gray-400">
                      {publishedOn}
                      {publishedOn && categoryLabel ? ' · ' : ''}
                      {categoryLabel}
                    </p>
                  ) : null}
                  {summary ? <p className="m-0 text-sm muted leading-relaxed">{summary}</p> : null}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
