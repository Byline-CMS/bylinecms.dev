/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { PersistedVariant, StoredFileValue } from '@byline/core'
import { Badge } from '@infonomic/uikit/react'

import { LexicalRichText } from '@/ui/byline/components/richtext-lexical'
import type { NewsDetailResult } from '@/modules/news/detail'

interface NewsDetailProps {
  result: NonNullable<NewsDetailResult>
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

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

export function NewsDetail({ result }: NewsDetailProps) {
  const { fields } = result
  const title = fields.title ?? result.path ?? result.id
  const categoryLabel = fields.category?.document?.fields.name
  const featureImage = fields.featureImage?.document?.fields.image
  const heroUrl = pickVariantUrl(featureImage, 'hero', 'card', 'thumbnail')
  const imageAlt =
    fields.featureImage?.document?.fields.altText ??
    fields.featureImage?.document?.fields.title ??
    title
  const publishedOn = fields.publishedOn
    ? dateFormatter.format(new Date(fields.publishedOn))
    : undefined

  const content = fields.content as Record<string, any> | undefined

  return (
    <article className="prose max-w-[940px] mx-auto mt-4">
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          {categoryLabel && <Badge className="m-0 text-xs">{categoryLabel}</Badge>}
          {publishedOn && <span className="m-0 text-xs text-gray-400">{publishedOn}</span>}
        </div>
        <h1 className="m-0">{title}</h1>
        {fields.summary ? (
          <p className="mt-3 text-base text-gray-600 leading-relaxed">{fields.summary}</p>
        ) : null}
      </header>
      {heroUrl ? (
        <div className="mb-6 overflow-hidden">
          <img src={heroUrl} alt={imageAlt} className="h-auto w-full object-cover" />
        </div>
      ) : null}
      {/*
        Rich-text rendering is not yet wired on the public side. The
        `content` field is a Lexical document — render with a public
        Lexical reader (e.g. a tree-walker over `content.root.children`)
        once one ships in `@byline/richtext-lexical`.
      */}
      <LexicalRichText
        nodes={content?.root?.children}
        lng="en"
        wrapInDiv={false}
        className="editor-text"
      />
    </article>
  )
}
