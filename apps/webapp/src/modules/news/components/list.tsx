/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { FindResult } from '@byline/client'
import { Card } from '@infonomic/uikit/react'

import { truncate } from '@/utils/utils.general'

interface NewsListProps {
  result: FindResult
  category?: string
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
            const title =
              typeof doc.fields.title === 'string' ? doc.fields.title : (doc.path ?? doc.id)
            const categoryLabel = readPopulatedCategoryName(doc.fields.category)
            const thumbnailUrl = readFeatureImageThumbnailUrl(doc.fields.featureImage)
            const imageAlt = readFeatureImageAlt(doc.fields.featureImage) ?? title
            const publishedOn = formatPublishedDate(doc.fields.publishedOn)
            const summary =
              typeof doc.fields.summary === 'string'
                ? truncate(doc.fields.summary, 150, true)
                : undefined

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
                  <h2>
                    {title}
                  </h2>
                  {publishedOn || categoryLabel ? (
                    <p className="m-0 text-xs text-gray-400">
                      {publishedOn}
                      {publishedOn && categoryLabel ? ' · ' : ''}
                      {categoryLabel}
                    </p>
                  ) : null}
                  {summary ? (
                    <p className="m-0 text-sm muted leading-relaxed">{summary}</p>
                  ) : null}
                </div>

              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers — extract data from populated relation envelopes
// ---------------------------------------------------------------------------

function readPopulatedCategoryName(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  const doc = (v.document ?? v.target) as Record<string, unknown> | undefined
  const fields = doc?.fields as Record<string, unknown> | undefined
  const name = fields?.name
  return typeof name === 'string' ? name : undefined
}

function readFeatureImageThumbnailUrl(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  const doc = (v.document ?? v.target) as Record<string, unknown> | undefined
  const fields = doc?.fields as Record<string, unknown> | undefined
  const image = fields?.image as Record<string, unknown> | undefined
  if (!image) return undefined

  const variants = image.variants as Array<Record<string, unknown>> | undefined
  if (Array.isArray(variants)) {
    const thumbnail =
      variants.find((vr) => vr.name === 'thumbnail') ?? variants.find((vr) => vr.name === 'card')
    if (typeof thumbnail?.storageUrl === 'string') return thumbnail.storageUrl
  }

  return typeof image.storageUrl === 'string' ? image.storageUrl : undefined
}

function readFeatureImageAlt(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  const doc = (v.document ?? v.target) as Record<string, unknown> | undefined
  const fields = doc?.fields as Record<string, unknown> | undefined
  const alt = fields?.altText ?? fields?.title
  return typeof alt === 'string' ? alt : undefined
}

function formatPublishedDate(value: unknown): string | undefined {
  if (!value) return undefined
  const date = new Date(value as string)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
