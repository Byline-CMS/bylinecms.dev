/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { Badge } from '@byline/ui/react'

import { ResponsiveImage } from '@/ui/byline/components/responsive-image'
import { LexicalRichText } from '@/ui/byline/components/richtext-lexical'
import type { Locale } from '@/i18n/i18n-config'
import type { NewsDetailsResult } from '@/modules/news/details'

interface NewsDetailsProps {
  /** Locale for body-link building (passed from the route's resolved locale). */
  lng: Locale
  result: NonNullable<NewsDetailsResult>
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

export function NewsDetails({ result, lng }: NewsDetailsProps) {
  const { fields } = result
  const title = fields.title ?? result.path ?? result.id
  const categoryLabel = fields.category?.document?.fields.name
  const featureMedia = fields.featureImage?.document?.fields
  const featureImage = featureMedia?.image
  const imageAlt = featureMedia?.altText ?? featureMedia?.title ?? title
  const publishedOn = fields.publishedOn
    ? dateFormatter.format(new Date(fields.publishedOn))
    : undefined

  // TODO: richText is a Lexical document — type properly once the
  // Lexical node shape is modelled in @byline/core.
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
          <p className="mt-3 text-base muted leading-relaxed">{fields.summary}</p>
        ) : null}
      </header>
      {featureImage ? (
        <ResponsiveImage
          image={featureImage}
          size="large"
          alt={imageAlt}
          className="mb-6"
          imgClassName="h-auto w-full object-cover"
          loading="eager"
          fetchPriority="high"
        />
      ) : null}
      <LexicalRichText
        nodes={content?.root?.children}
        lng={lng}
        wrapInDiv={false}
        className="editor-text"
      />
    </article>
  )
}
